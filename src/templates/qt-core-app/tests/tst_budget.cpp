#include "domain/budget.h"

#include <QTest>

// Budget::status on its own: no ledger, no file, no window. A rule goes wrong
// at its edges, so the edges are what is tested.
class TestBudget : public QObject
{
    Q_OBJECT

private slots:
    void status_data();
    void status();
};

// Each row is a run of status() below, named in the test's output.
void TestBudget::status_data()
{
    QTest::addColumn<qint64>("spent");
    QTest::addColumn<qint64>("limit");
    QTest::addColumn<Budget::Status>("expected");

    QTest::newRow("no limit") << qint64(5000) << qint64(0) << Budget::NoLimit;
    QTest::newRow("nothing spent") << qint64(0) << qint64(10000) << Budget::WithinBudget;
    QTest::newRow("a cent short of 80%") << qint64(7999) << qint64(10000) << Budget::WithinBudget;
    QTest::newRow("80%") << qint64(8000) << qint64(10000) << Budget::NearLimit;
    QTest::newRow("all of it") << qint64(10000) << qint64(10000) << Budget::NearLimit;
    QTest::newRow("a cent over") << qint64(10001) << qint64(10000) << Budget::OverBudget;
}

void TestBudget::status()
{
    QFETCH(qint64, spent);
    QFETCH(qint64, limit);
    QFETCH(Budget::Status, expected);

    QCOMPARE(Budget::status(spent, limit), expected);
}

// A main() with a QCoreApplication: the core needs no QGuiApplication.
QTEST_GUILESS_MAIN(TestBudget)
// The test class is declared in this file, so moc's output is included here.
#include "tst_budget.moc"
