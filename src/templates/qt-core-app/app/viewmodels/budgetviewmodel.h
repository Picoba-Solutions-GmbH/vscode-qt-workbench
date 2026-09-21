#ifndef BUDGETVIEWMODEL_H
#define BUDGETVIEWMODEL_H

#include "domain/category.h"

#include <QAbstractListModel>
#include <QList>
#include <QString>
#include <QtQmlIntegration>

class Ledger;
class QJSEngine;
class QQmlEngine;

// What the Budget view shows: a row for each category, with what was spent
// on it this month against its limit.
//
// A QML singleton that main() makes, like ExpensesViewModel.
class BudgetViewModel : public QAbstractListModel
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

    Q_PROPERTY(QString month READ month NOTIFY monthChanged)

public:
    enum Roles {
        CategoryRole = Qt::UserRole + 1,
        SpentRole,
        // Empty when there is no limit.
        LimitRole,
        // What was spent, as a share of the limit: 1 is all of it. 0 when
        // there is no limit.
        ShareRole,
        // A Budget::Status, which QML compares with Budget.OverBudget and
        // the rest.
        StatusRole
    };

    explicit BudgetViewModel(Ledger *ledger, QObject *parent = nullptr);
    ~BudgetViewModel() override;

    // QML asks for the singleton here, and gets the one main() made.
    static BudgetViewModel *create(QQmlEngine *qmlEngine, QJSEngine *jsEngine);

    int rowCount(const QModelIndex &parent = QModelIndex()) const override;
    QVariant data(const QModelIndex &index, int role) const override;
    QHash<int, QByteArray> roleNames() const override;

    QString month() const;

    // Sets the monthly limit of the category in `row`; an empty `amount`
    // takes it away. Returns what is wrong with it, or an empty string.
    Q_INVOKABLE QString setLimit(int row, const QString &amount);

signals:
    void monthChanged();

private:
    Ledger *m_ledger;
    const QList<Category::Kind> m_categories;

    static inline BudgetViewModel *s_instance = nullptr;
};

#endif // BUDGETVIEWMODEL_H
