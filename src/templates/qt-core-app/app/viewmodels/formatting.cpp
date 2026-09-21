#include "formatting.h"

#include <QCoreApplication>
#include <QLocale>

#include <cmath>

QString Formatting::money(qint64 cents)
{
    return QLocale().toCurrencyString(static_cast<double>(cents) / 100);
}

std::optional<qint64> Formatting::parseMoney(const QString &text)
{
    // The user's locale first, then the C locale, so "12.50" is understood
    // where the locale writes "12,50" too. Neither takes a group separator:
    // in German "1.250" is 1250, and in English 1.25 -- too easy to mistype.
    QLocale user;
    user.setNumberOptions(QLocale::RejectGroupSeparator);
    QLocale c = QLocale::c();
    c.setNumberOptions(QLocale::RejectGroupSeparator);

    for (const QLocale &locale : { user, c }) {
        bool ok = false;
        const double value = locale.toDouble(text.trimmed(), &ok);
        if (!ok || !std::isfinite(value) || std::abs(value) > 1e12)
            continue;
        const double cents = value * 100;
        const qint64 whole = qRound64(cents);
        // 12.345 is not an amount of money.
        if (std::abs(cents - static_cast<double>(whole)) > 1e-6)
            return std::nullopt;
        return whole;
    }
    return std::nullopt;
}

QString Formatting::moneyExample()
{
    return QLocale().toString(12.5, 'f', 2);
}

QString Formatting::categoryName(Category::Kind category)
{
    // No default: when a category is added to the enum, the compiler warns
    // that it has no name here.
    switch (category) {
    case Category::Food:
        return QCoreApplication::translate("Formatting", "Food");
    case Category::Housing:
        return QCoreApplication::translate("Formatting", "Housing");
    case Category::Transport:
        return QCoreApplication::translate("Formatting", "Transport");
    case Category::Leisure:
        return QCoreApplication::translate("Formatting", "Leisure");
    case Category::Other:
        return QCoreApplication::translate("Formatting", "Other");
    }
    return {};
}

QString Formatting::month(QDate day)
{
    // The standalone name: in some languages a month on its own is spelled
    // differently from a month in a date.
    return QLocale().standaloneMonthName(day.month()) + u' ' + QString::number(day.year());
}

QString Formatting::date(QDate day)
{
    return QLocale().toString(day, QLocale::ShortFormat);
}
