#include "ledgerfile.h"

#include "domain/ledger.h"

#include <QCoreApplication>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSaveFile>
#include <QSet>

#include <optional>

QString LedgerFile::read(const QString &path, Ledger &ledger)
{
    QFile file(path);
    if (!file.open(QIODevice::ReadOnly))
        return file.errorString();

    QJsonParseError parseError;
    const QJsonDocument document = QJsonDocument::fromJson(file.readAll(), &parseError);
    if (parseError.error != QJsonParseError::NoError) {
        return QCoreApplication::translate("LedgerFile", "It is not JSON: %1 at offset %2.")
            .arg(parseError.errorString())
            .arg(parseError.offset);
    }
    if (!document.isObject())
        return QCoreApplication::translate("LedgerFile", "It holds no JSON object.");
    const QJsonObject root = document.object();

    // Everything is checked before the ledger changes: a file that is wrong
    // anywhere changes nothing.
    QList<Expense> expenses;
    QSet<int> ids;
    const QJsonArray entries = root.value(u"expenses").toArray();
    for (qsizetype i = 0; i < entries.size(); ++i) {
        const QJsonObject entry = entries.at(i).toObject();
        Expense expense;
        expense.id = entry.value(u"id").toInt();
        expense.date = QDate::fromString(entry.value(u"date").toString(), Qt::ISODate);
        expense.description = entry.value(u"description").toString();
        expense.amountCents = entry.value(u"amountCents").toInteger();
        const QString key = entry.value(u"category").toString();
        const std::optional<Category::Kind> category = Category::fromKey(key);

        QString problem;
        if (expense.id <= 0 || ids.contains(expense.id)) {
            problem = QCoreApplication::translate("LedgerFile", "Its id is missing or not its own.");
        } else if (!category) {
            problem = QCoreApplication::translate("LedgerFile", "There is no category \"%1\".").arg(key);
        } else {
            expense.category = *category;
            problem = problemWith(expense);
        }
        if (!problem.isEmpty())
            return QCoreApplication::translate("LedgerFile", "Expense %1: %2").arg(i + 1).arg(problem);

        ids.insert(expense.id);
        expenses.append(expense);
    }

    QMap<Category::Kind, qint64> limits;
    const QJsonObject limitEntries = root.value(u"limits").toObject();
    for (auto it = limitEntries.constBegin(); it != limitEntries.constEnd(); ++it) {
        const std::optional<Category::Kind> category = Category::fromKey(it.key());
        const qint64 cents = it.value().toInteger(-1);
        if (!category)
            return QCoreApplication::translate("LedgerFile", "Limits: there is no category \"%1\".").arg(it.key());
        if (cents < 0)
            return QCoreApplication::translate("LedgerFile", "Limits: %1 is not a number of cents.").arg(it.key());
        if (cents > 0)
            limits.insert(*category, cents);
    }

    ledger.reset(std::move(expenses), std::move(limits));
    return {};
}

QString LedgerFile::write(const QString &path, const Ledger &ledger)
{
    QJsonArray expenses;
    for (const Expense &e : ledger.expenses()) {
        expenses.append(QJsonObject{
            { QStringLiteral("id"), e.id },
            { QStringLiteral("date"), e.date.toString(Qt::ISODate) },
            { QStringLiteral("description"), e.description },
            { QStringLiteral("category"), Category::key(e.category) },
            { QStringLiteral("amountCents"), e.amountCents },
        });
    }
    QJsonObject limits;
    for (auto it = ledger.limits().constBegin(); it != ledger.limits().constEnd(); ++it)
        limits.insert(Category::key(it.key()), it.value());

    const QJsonObject root{
        { QStringLiteral("expenses"), expenses },
        { QStringLiteral("limits"), limits },
    };

    const QString folder = QFileInfo(path).absolutePath();
    if (!QDir().mkpath(folder))
        return QCoreApplication::translate("LedgerFile", "Cannot create the folder %1.").arg(QDir::toNativeSeparators(folder));

    // QSaveFile writes to a temporary file and puts it in place on commit().
    QSaveFile file(path);
    if (!file.open(QIODevice::WriteOnly))
        return file.errorString();
    file.write(QJsonDocument(root).toJson());
    if (!file.commit())
        return file.errorString();
    return {};
}
