#include "domain/ledger.h"

#include <QSignalSpy>
#include <QTest>

using namespace Qt::StringLiterals;

// The ledger's rules: what it accepts, where an expense goes, what it adds
// up, and the signals the app's view models follow.
class TestLedger : public QObject
{
    Q_OBJECT

private slots:
    void refusesAnExpenseWithAProblem_data();
    void refusesAnExpenseWithAProblem();
    void keepsTheNewestFirst();
    void addsUpAMonth();
    void removes();
    void setsAndTakesAwayLimits();
    void resetSortsAndKeepsIds();

private:
    // An expense of September 2026.
    static Expense expense(int day, const QString &description, Category::Kind category = Category::Food, qint64 cents = 100);
};

Expense TestLedger::expense(int day, const QString &description, Category::Kind category, qint64 cents)
{
    return { 0, QDate(2026, 9, day), description, category, cents };
}

void TestLedger::refusesAnExpenseWithAProblem_data()
{
    QTest::addColumn<Expense>("expense");

    QTest::newRow("no description") << Expense{ 0, QDate(2026, 9, 1), u"  "_s, Category::Food, 100 };
    QTest::newRow("nothing spent") << Expense{ 0, QDate(2026, 9, 1), u"Bread"_s, Category::Food, 0 };
    QTest::newRow("less than nothing") << Expense{ 0, QDate(2026, 9, 1), u"Bread"_s, Category::Food, -100 };
    QTest::newRow("no date") << Expense{ 0, QDate(), u"Bread"_s, Category::Food, 100 };
}

void TestLedger::refusesAnExpenseWithAProblem()
{
    QFETCH(Expense, expense);

    Ledger ledger;
    QSignalSpy changed(&ledger, &Ledger::changed);

    QVERIFY(!ledger.add(expense).isEmpty());
    QVERIFY(ledger.expenses().isEmpty());
    QCOMPARE(changed.count(), 0);
}

void TestLedger::keepsTheNewestFirst()
{
    Ledger ledger;
    QSignalSpy added(&ledger, &Ledger::expenseAdded);

    QVERIFY(ledger.add(expense(10, u"Middle"_s)).isEmpty());
    QVERIFY(ledger.add(expense(20, u"Newest"_s)).isEmpty());
    QVERIFY(ledger.add(expense(1, u"Oldest"_s)).isEmpty());
    QVERIFY(ledger.add(expense(10, u"Middle, added later"_s)).isEmpty());

    QStringList order;
    QList<int> ids;
    for (const Expense &e : ledger.expenses()) {
        order.append(e.description);
        ids.append(e.id);
    }
    QCOMPARE(order, QStringList({ u"Newest"_s, u"Middle, added later"_s, u"Middle"_s, u"Oldest"_s }));
    QCOMPARE(ids, QList<int>({ 2, 4, 1, 3 }));

    // Each signal named the row its expense went to, as a view needs to know.
    QCOMPARE(added.count(), 4);
    QCOMPARE(added.at(0).at(0).toInt(), 0);
    QCOMPARE(added.at(1).at(0).toInt(), 0);
    QCOMPARE(added.at(2).at(0).toInt(), 2);
    QCOMPARE(added.at(3).at(0).toInt(), 1);
}

void TestLedger::addsUpAMonth()
{
    Ledger ledger;
    ledger.add({ 0, QDate(2026, 8, 31), u"August"_s, Category::Food, 1000 });
    ledger.add(expense(1, u"Bread"_s, Category::Food, 250));
    ledger.add(expense(30, u"Train pass"_s, Category::Transport, 4900));
    ledger.add({ 0, QDate(2025, 9, 15), u"A year ago"_s, Category::Food, 700 });

    const QDate september(2026, 9, 18);
    QCOMPARE(ledger.spentInMonth(september), qint64(5150));
    QCOMPARE(ledger.spentInMonth(september, Category::Food), qint64(250));
    QCOMPARE(ledger.spentInMonth(september, Category::Leisure), qint64(0));
    QCOMPARE(ledger.spentInMonth(QDate(2026, 8, 1)), qint64(1000));
}

void TestLedger::removes()
{
    Ledger ledger;
    ledger.add(expense(1, u"Older"_s));
    ledger.add(expense(2, u"Newer"_s));
    const int older = ledger.expenses().at(1).id;
    QSignalSpy removed(&ledger, &Ledger::expenseRemoved);

    QVERIFY(ledger.remove(older));
    QCOMPARE(removed.count(), 1);
    QCOMPARE(removed.at(0).at(0).toInt(), 1);
    QCOMPARE(ledger.expenses().size(), 1);

    // Gone already: nothing to remove, nothing said.
    QVERIFY(!ledger.remove(older));
    QCOMPARE(removed.count(), 1);
}

void TestLedger::setsAndTakesAwayLimits()
{
    Ledger ledger;
    QSignalSpy changed(&ledger, &Ledger::changed);

    QVERIFY(ledger.setLimit(Category::Food, 40000).isEmpty());
    QCOMPARE(ledger.limit(Category::Food), qint64(40000));
    QCOMPARE(ledger.limit(Category::Housing), qint64(0));
    QCOMPARE(changed.count(), 1);

    QVERIFY(!ledger.setLimit(Category::Food, -1).isEmpty());
    QCOMPARE(ledger.limit(Category::Food), qint64(40000));
    // The same limit again is no change.
    QVERIFY(ledger.setLimit(Category::Food, 40000).isEmpty());
    QCOMPARE(changed.count(), 1);

    QVERIFY(ledger.setLimit(Category::Food, 0).isEmpty());
    QVERIFY(!ledger.limits().contains(Category::Food));
    QCOMPARE(changed.count(), 2);
}

void TestLedger::resetSortsAndKeepsIds()
{
    Ledger ledger;
    QSignalSpy reset(&ledger, &Ledger::wasReset);

    ledger.reset({ { 7, QDate(2026, 9, 1), u"Old"_s, Category::Food, 100 },
                   { 3, QDate(2026, 9, 5), u"New"_s, Category::Food, 200 } },
                 { { Category::Leisure, 2000 } });

    QCOMPARE(reset.count(), 1);
    QCOMPARE(ledger.expenses().at(0).id, 3);
    QCOMPARE(ledger.expenses().at(1).id, 7);
    QCOMPARE(ledger.limit(Category::Leisure), qint64(2000));

    // The next id comes after the highest one there is.
    ledger.add(expense(18, u"Next"_s));
    QCOMPARE(ledger.expenses().at(0).id, 8);
}

QTEST_GUILESS_MAIN(TestLedger)
#include "tst_ledger.moc"
