#ifndef BUDGET_H
#define BUDGET_H

#include <QObject>

// Where the spending of a month stands against its limit.
//
// A rule of the application, so it lives here and is tested in
// tests/tst_budget.cpp. What each status looks like -- green, orange, red --
// is the user interface's business (app/components/BudgetBar.qml).
namespace Budget {
Q_NAMESPACE

enum Status {
    NoLimit,
    WithinBudget,
    NearLimit,
    OverBudget
};
Q_ENUM_NS(Status)

// From this share of the limit on, spending is near it.
constexpr int NearLimitPercent = 80;

// The status of `spentCents` against `limitCents`. A limit of 0 is none.
Status status(qint64 spentCents, qint64 limitCents);

} // namespace Budget

#endif // BUDGET_H
