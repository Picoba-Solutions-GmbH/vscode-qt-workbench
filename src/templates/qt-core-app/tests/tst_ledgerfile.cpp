#include "domain/ledger.h"
#include "storage/ledgerfile.h"

#include <QFile>
#include <QSignalSpy>
#include <QTemporaryDir>
#include <QTest>

using namespace Qt::StringLiterals;

// A ledger written and read back, and the files that are refused. Each test
// works in a temporary folder, removed when the test ends.
class TestLedgerFile : public QObject
{
    Q_OBJECT

private slots:
    void readsBackWhatItWrote();
    void createsTheFolder();
    void refusesABrokenFile_data();
    void refusesABrokenFile();
    void aMissingFileIsAProblem();
};

void TestLedgerFile::readsBackWhatItWrote()
{
    QTemporaryDir dir;
    QVERIFY(dir.isValid());
    const QString path = dir.filePath(u"ledger.json"_s);

    Ledger original;
    original.add({ 0, QDate(2026, 9, 1), u"Rent"_s, Category::Housing, 85000 });
    original.add({ 0, QDate(2026, 9, 18), u"Groceries, \"organic\""_s, Category::Food, 4230 });
    original.setLimit(Category::Food, 40000);
    QCOMPARE(LedgerFile::write(path, original), QString());

    Ledger copy;
    QCOMPARE(LedgerFile::read(path, copy), QString());

    QCOMPARE(copy.expenses().size(), original.expenses().size());
    for (qsizetype i = 0; i < original.expenses().size(); ++i) {
        const Expense &written = original.expenses().at(i);
        const Expense &read = copy.expenses().at(i);
        QCOMPARE(read.id, written.id);
        QCOMPARE(read.date, written.date);
        QCOMPARE(read.description, written.description);
        QCOMPARE(read.category, written.category);
        QCOMPARE(read.amountCents, written.amountCents);
    }
    QCOMPARE(copy.limits(), original.limits());
}

void TestLedgerFile::createsTheFolder()
{
    QTemporaryDir dir;
    const QString path = dir.filePath(u"not/there/yet/ledger.json"_s);

    Ledger ledger;
    QCOMPARE(LedgerFile::write(path, ledger), QString());
    QVERIFY(QFile::exists(path));
}

void TestLedgerFile::refusesABrokenFile_data()
{
    QTest::addColumn<QByteArray>("content");
    QTest::addColumn<QString>("problem");

    QTest::newRow("not JSON") << QByteArray("{") << u"It is not JSON"_s;
    QTest::newRow("no object") << QByteArray("[]") << u"It holds no JSON object."_s;
    QTest::newRow("unknown category")
        << QByteArray(R"({"expenses": [{"id": 1, "date": "2026-09-01", "description": "Cat food", "category": "Pets", "amountCents": 100}]})")
        << u"Expense 1: There is no category \"Pets\"."_s;
    QTest::newRow("the same id twice")
        << QByteArray(R"({"expenses": [{"id": 1, "date": "2026-09-01", "description": "Bread", "category": "Food", "amountCents": 100},
                                       {"id": 1, "date": "2026-09-02", "description": "Milk", "category": "Food", "amountCents": 100}]})")
        << u"Expense 2: Its id is missing or not its own."_s;
    QTest::newRow("nothing spent")
        << QByteArray(R"({"expenses": [{"id": 1, "date": "2026-09-01", "description": "Bread", "category": "Food", "amountCents": 0}]})")
        << u"Expense 1: The amount has to be more than zero."_s;
    QTest::newRow("no such date")
        << QByteArray(R"({"expenses": [{"id": 1, "date": "2026-13-01", "description": "Bread", "category": "Food", "amountCents": 100}]})")
        << u"Expense 1: The expense needs a date."_s;
    QTest::newRow("a negative limit") << QByteArray(R"({"limits": {"Food": -5}})") << u"Limits: Food is not a number of cents."_s;
}

void TestLedgerFile::refusesABrokenFile()
{
    QFETCH(QByteArray, content);
    QFETCH(QString, problem);

    QTemporaryDir dir;
    const QString path = dir.filePath(u"ledger.json"_s);
    QFile file(path);
    QVERIFY(file.open(QIODevice::WriteOnly));
    file.write(content);
    file.close();

    Ledger ledger;
    ledger.add({ 0, QDate(2026, 9, 1), u"Kept"_s, Category::Other, 100 });
    QSignalSpy reset(&ledger, &Ledger::wasReset);

    const QString result = LedgerFile::read(path, ledger);
    QVERIFY2(result.startsWith(problem), qPrintable(result));
    // Nothing of the file was taken.
    QCOMPARE(reset.count(), 0);
    QCOMPARE(ledger.expenses().size(), 1);
}

void TestLedgerFile::aMissingFileIsAProblem()
{
    QTemporaryDir dir;
    Ledger ledger;
    QVERIFY(!LedgerFile::read(dir.filePath(u"missing.json"_s), ledger).isEmpty());
}

QTEST_GUILESS_MAIN(TestLedgerFile)
#include "tst_ledgerfile.moc"
