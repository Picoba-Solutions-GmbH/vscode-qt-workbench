#include "ledger.h"

#include <QCoreApplication>

#include <algorithm>

Ledger::Ledger(QObject *parent)
    : QObject(parent)
{
}

const QList<Expense> &Ledger::expenses() const
{
    return m_expenses;
}

QString Ledger::add(Expense expense)
{
    const QString problem = problemWith(expense);
    if (!problem.isEmpty())
        return problem;

    expense.id = m_nextId++;
    expense.description = expense.description.trimmed();
    const int row = rowFor(expense.date);
    m_expenses.insert(row, expense);

    emit expenseAdded(row);
    emit changed();
    return {};
}

bool Ledger::remove(int expenseId)
{
    const auto it = std::find_if(m_expenses.cbegin(), m_expenses.cend(),
                                 [expenseId](const Expense &e) { return e.id == expenseId; });
    if (it == m_expenses.cend())
        return false;

    const int row = static_cast<int>(it - m_expenses.cbegin());
    m_expenses.removeAt(row);

    emit expenseRemoved(row);
    emit changed();
    return true;
}

qint64 Ledger::limit(Category::Kind category) const
{
    return m_limits.value(category, 0);
}

const QMap<Category::Kind, qint64> &Ledger::limits() const
{
    return m_limits;
}

QString Ledger::setLimit(Category::Kind category, qint64 limitCents)
{
    if (limitCents < 0)
        return QCoreApplication::translate("Ledger", "A limit cannot be less than zero.");
    if (limit(category) == limitCents)
        return {};

    if (limitCents == 0)
        m_limits.remove(category);
    else
        m_limits.insert(category, limitCents);

    emit limitChanged(category);
    emit changed();
    return {};
}

qint64 Ledger::spentInMonth(QDate day) const
{
    qint64 sum = 0;
    for (const Expense &e : m_expenses) {
        if (e.date.year() == day.year() && e.date.month() == day.month())
            sum += e.amountCents;
    }
    return sum;
}

qint64 Ledger::spentInMonth(QDate day, Category::Kind category) const
{
    qint64 sum = 0;
    for (const Expense &e : m_expenses) {
        if (e.category == category && e.date.year() == day.year() && e.date.month() == day.month())
            sum += e.amountCents;
    }
    return sum;
}

void Ledger::reset(QList<Expense> expenses, QMap<Category::Kind, qint64> limits)
{
    // Newest first, and on the same day the higher id -- the one added later --
    // first, as add() places them.
    std::sort(expenses.begin(), expenses.end(), [](const Expense &a, const Expense &b) {
        return a.date != b.date ? a.date > b.date : a.id > b.id;
    });
    m_expenses = std::move(expenses);
    m_limits = std::move(limits);

    m_nextId = 1;
    for (const Expense &e : std::as_const(m_expenses))
        m_nextId = std::max(m_nextId, e.id + 1);

    emit wasReset();
    emit changed();
}

int Ledger::rowFor(QDate date) const
{
    const auto it = std::find_if(m_expenses.cbegin(), m_expenses.cend(),
                                 [date](const Expense &e) { return e.date <= date; });
    return static_cast<int>(it - m_expenses.cbegin());
}
