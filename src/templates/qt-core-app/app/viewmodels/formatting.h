#ifndef FORMATTING_H
#define FORMATTING_H

#include "domain/category.h"

#include <QDate>
#include <QString>

#include <optional>

// What the core holds, as the user reads and types it.
//
// The core counts whole cents and names categories for files. The currency,
// the decimal separator and the translated names are the user interface's
// business, done here in the user's locale.
namespace Formatting {

// 4230 cents as "42,30 €" or "$42.30".
QString money(qint64 cents);

// An amount the user typed, in cents: "42.3" and, where the locale writes it
// so, "42,30". None when it is no number, or has more than two decimals.
std::optional<qint64> parseMoney(const QString &text);

// A number to show in a message, the way the user types one: "12,50".
QString moneyExample();

QString categoryName(Category::Kind category);

// "September 2026"
QString month(QDate day);

QString date(QDate day);

} // namespace Formatting

#endif // FORMATTING_H
