#ifndef LEDGER_H
#define LEDGER_H

#include "category.h"
#include "expense.h"

#include <QDate>
#include <QList>
#include <QMap>
#include <QObject>
#include <QString>

// The expenses and the monthly limit of each category: all the application
// knows.
//
// A QObject for its signals: whoever shows the ledger or saves it hears about
// every change, and the ledger knows nothing about who that is. Signals are
// Qt Core; they are not user interface code.
class Ledger : public QObject
{
    Q_OBJECT

public:
    explicit Ledger(QObject *parent = nullptr);

    // Newest first.
    const QList<Expense> &expenses() const;

    // Adds the expense, giving it an id. When problemWith() finds something
    // wrong with it, returns that instead and adds nothing.
    QString add(Expense expense);
    // Returns false when there is no expense with that id.
    bool remove(int expenseId);

    // The monthly limit of a category, in cents. 0 is none.
    qint64 limit(Category::Kind category) const;
    const QMap<Category::Kind, qint64> &limits() const;
    // Returns what is wrong with the limit instead, and changes nothing.
    QString setLimit(Category::Kind category, qint64 limitCents);

    // What was spent in the month `day` falls in: on everything, or on one
    // category. The caller says which month; the ledger never reads the clock,
    // so a test can ask about any month it likes.
    qint64 spentInMonth(QDate day) const;
    qint64 spentInMonth(QDate day, Category::Kind category) const;

    // Replaces everything, as reading a file does. The expenses are sorted
    // newest first; their ids are kept.
    void reset(QList<Expense> expenses, QMap<Category::Kind, qint64> limits);

signals:
    // expenses() has a new expense at `row`.
    void expenseAdded(int row);
    // The expense that was at `row` is gone.
    void expenseRemoved(int row);
    void limitChanged(Category::Kind category);
    // reset() replaced everything.
    void wasReset();
    // After each of the above: the time to save.
    void changed();

private:
    // Where an expense of that date goes, newest first. On the same day the
    // expense added last comes first.
    int rowFor(QDate date) const;

    QList<Expense> m_expenses;
    QMap<Category::Kind, qint64> m_limits;
    int m_nextId = 1;
};

#endif // LEDGER_H
