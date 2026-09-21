#include "viewmodels/budgetviewmodel.h"
#include "viewmodels/expensesviewmodel.h"

#include "domain/ledger.h"
#include "storage/ledgerfile.h"

#include <QDebug>
#include <QDir>
#include <QFile>
#include <QGuiApplication>
#include <QQmlApplicationEngine>
#include <QStandardPaths>

// A few expenses and limits for the first start, so the views have something
// to show: one category within its limit, one near it, one over it and one
// without a limit.
static void addSampleData(Ledger &ledger)
{
    const QDate today = QDate::currentDate();
    ledger.add({ 0, today.addDays(-3), QStringLiteral("Rent"), Category::Housing, 85000 });
    ledger.add({ 0, today.addDays(-2), QStringLiteral("Monthly train pass"), Category::Transport, 4900 });
    ledger.add({ 0, today.addDays(-1), QStringLiteral("Cinema"), Category::Leisure, 2400 });
    ledger.add({ 0, today, QStringLiteral("Groceries"), Category::Food, 4230 });
    ledger.setLimit(Category::Food, 40000);
    ledger.setLimit(Category::Transport, 6000);
    ledger.setLimit(Category::Leisure, 2000);
}

int main(int argc, char *argv[])
{
    QGuiApplication app(argc, argv);
    // QStandardPaths names the application's data folder after it.
    QCoreApplication::setApplicationName(QStringLiteral("%{ProjectName}"));

    // main() is where the parts meet. The core's objects are made here, and
    // live as long as the application.
    Ledger ledger;

    const QString file = QDir(QStandardPaths::writableLocation(QStandardPaths::AppDataLocation))
                             .filePath(QStringLiteral("ledger.json"));
    bool save = true;
    if (!QFile::exists(file)) {
        addSampleData(ledger);
    } else if (const QString problem = LedgerFile::read(file, ledger); !problem.isEmpty()) {
        // Leave the file as it is, to be repaired: nothing is saved over it.
        qWarning().noquote() << "Cannot read" << QDir::toNativeSeparators(file) << "--" << problem
                             << "Changes are not saved.";
        save = false;
    }
    if (save) {
        // The ledger says when it changed; saving is the application's idea.
        QObject::connect(&ledger, &Ledger::changed, &ledger, [&ledger, file]() {
            const QString problem = LedgerFile::write(file, ledger);
            if (!problem.isEmpty())
                qWarning().noquote() << "Cannot save" << QDir::toNativeSeparators(file) << "--" << problem;
        });
    }

    // The view models present the core to the QML. They are QML singletons
    // whose create() returns these, so they are made before QML starts, and
    // destroyed after it.
    ExpensesViewModel expenses(&ledger);
    BudgetViewModel budget(&ledger);

    QQmlApplicationEngine engine;
    QObject::connect(
        &engine,
        &QQmlApplicationEngine::objectCreationFailed,
        &app,
        []() { QCoreApplication::exit(-1); },
        Qt::QueuedConnection);
    engine.loadFromModule("%{ProjectName}", "Main");

    return QGuiApplication::exec();
}
