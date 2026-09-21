#ifndef EXPENSE_H
#define EXPENSE_H

#include "category.h"

#include <QDate>
#include <QString>

// One expense. Plain data: the ledger keeps them, and the user interface only
// ever sees the fields its view models pick out.
//
// An amount is whole cents in a 64-bit integer, never a double: 0.1 + 0.2 is
// not 0.3 in floating point, and money has to add up to the cent.
struct Expense
{
    int id = 0;
    QDate date;
    QString description;
    Category::Kind category = Category::Other;
    qint64 amountCents = 0;
};

// What is wrong with an expense, or an empty string when nothing is. The ledger
// refuses an expense with a problem, and the user interface shows the text.
QString problemWith(const Expense &expense);

#endif // EXPENSE_H
