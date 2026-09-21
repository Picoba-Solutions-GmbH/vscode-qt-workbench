#include "expense.h"

#include <QCoreApplication>

// QCoreApplication::translate() is Qt Core's tr(): the texts can be
// translated without the core linking anything more.
QString problemWith(const Expense &expense)
{
    if (expense.description.trimmed().isEmpty())
        return QCoreApplication::translate("Expense", "Say what the money was spent on.");
    if (expense.amountCents <= 0)
        return QCoreApplication::translate("Expense", "The amount has to be more than zero.");
    if (!expense.date.isValid())
        return QCoreApplication::translate("Expense", "The expense needs a date.");
    return {};
}
