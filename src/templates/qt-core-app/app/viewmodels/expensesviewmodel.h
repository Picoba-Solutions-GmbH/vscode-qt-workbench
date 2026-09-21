#ifndef EXPENSESVIEWMODEL_H
#define EXPENSESVIEWMODEL_H

#include "domain/expense.h"

#include <QAbstractListModel>
#include <QList>
#include <QString>
#include <QStringList>
#include <QtQmlIntegration>

class Ledger;
class QJSEngine;
class QQmlEngine;

// What the Expenses view shows, and what it can do.
//
// A view model stands between a view and the core. It reads the Ledger and
// turns its expenses into rows of text a ListView shows, and it turns what
// the user typed into calls on the Ledger. The QML never sees a Ledger or an
// Expense, and the Ledger never sees QML.
//
// A QML singleton that main() makes, handing it the Ledger: see create().
class ExpensesViewModel : public QAbstractListModel
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

    Q_PROPERTY(QString month READ month NOTIFY totalsChanged)
    Q_PROPERTY(QString monthTotal READ monthTotal NOTIFY totalsChanged)
    // The categories' names in the enum's order: a ComboBox's model, whose
    // currentIndex is then the category.
    Q_PROPERTY(QStringList categoryNames READ categoryNames CONSTANT)

public:
    // The names a delegate declares as required properties, in roleNames().
    enum Roles {
        ExpenseIdRole = Qt::UserRole + 1,
        DateRole,
        DescriptionRole,
        CategoryRole,
        AmountRole
    };

    explicit ExpensesViewModel(Ledger *ledger, QObject *parent = nullptr);
    ~ExpensesViewModel() override;

    // QML asks for the singleton here, and gets the one main() made. Its
    // QML engine never makes one of its own, so none is made without a
    // Ledger, and a QML hot reload keeps this one.
    static ExpensesViewModel *create(QQmlEngine *qmlEngine, QJSEngine *jsEngine);

    int rowCount(const QModelIndex &parent = QModelIndex()) const override;
    QVariant data(const QModelIndex &index, int role) const override;
    QHash<int, QByteArray> roleNames() const override;

    QString month() const;
    QString monthTotal() const;
    QStringList categoryNames() const;

    // Adds an expense, dated today. Returns what is wrong with it, or an
    // empty string when it was added.
    Q_INVOKABLE QString add(const QString &description, const QString &amount, int category);
    Q_INVOKABLE void remove(int expenseId);

signals:
    void totalsChanged();

private:
    Ledger *m_ledger;
    // The rows the view was last told about. See the constructor.
    QList<Expense> m_rows;

    static inline ExpensesViewModel *s_instance = nullptr;
};

#endif // EXPENSESVIEWMODEL_H
