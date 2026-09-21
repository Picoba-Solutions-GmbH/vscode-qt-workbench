#include "budgetviewmodel.h"

#include "formatting.h"

#include "domain/budget.h"
#include "domain/ledger.h"

#include <QJSEngine>

BudgetViewModel::BudgetViewModel(Ledger *ledger, QObject *parent)
    : QAbstractListModel(parent)
    , m_ledger(ledger)
    , m_categories(Category::all())
{
    s_instance = this;

    // The rows are the categories, which never change. What any change to
    // the ledger changes is the figures in them: all of them are refreshed,
    // five rows being cheap to paint.
    connect(ledger, &Ledger::changed, this, [this]() {
        emit dataChanged(index(0), index(rowCount() - 1));
        emit monthChanged();
    });
}

BudgetViewModel::~BudgetViewModel()
{
    if (s_instance == this)
        s_instance = nullptr;
}

BudgetViewModel *BudgetViewModel::create(QQmlEngine *, QJSEngine *)
{
    Q_ASSERT_X(s_instance, "BudgetViewModel::create", "main() makes the view model before QML uses it");
    // The engine deletes a singleton it owns. This one is main()'s.
    QJSEngine::setObjectOwnership(s_instance, QJSEngine::CppOwnership);
    return s_instance;
}

int BudgetViewModel::rowCount(const QModelIndex &parent) const
{
    if (parent.isValid())
        return 0;
    return static_cast<int>(m_categories.size());
}

QVariant BudgetViewModel::data(const QModelIndex &index, int role) const
{
    if (!index.isValid() || index.row() >= m_categories.size())
        return {};

    const Category::Kind category = m_categories.at(index.row());
    const qint64 spent = m_ledger->spentInMonth(QDate::currentDate(), category);
    const qint64 limit = m_ledger->limit(category);

    switch (role) {
    case CategoryRole:
        return Formatting::categoryName(category);
    case SpentRole:
        return Formatting::money(spent);
    case LimitRole:
        return limit > 0 ? Formatting::money(limit) : QString();
    case ShareRole:
        return limit > 0 ? static_cast<double>(spent) / static_cast<double>(limit) : 0.0;
    case StatusRole:
        return Budget::status(spent, limit);
    default:
        return {};
    }
}

QHash<int, QByteArray> BudgetViewModel::roleNames() const
{
    return {
        { CategoryRole, "category" },
        { SpentRole, "spent" },
        { LimitRole, "limit" },
        { ShareRole, "share" },
        { StatusRole, "status" },
    };
}

QString BudgetViewModel::month() const
{
    return Formatting::month(QDate::currentDate());
}

QString BudgetViewModel::setLimit(int row, const QString &amount)
{
    if (row < 0 || row >= m_categories.size())
        return {};

    qint64 cents = 0;
    if (!amount.trimmed().isEmpty()) {
        const std::optional<qint64> parsed = Formatting::parseMoney(amount);
        if (!parsed)
            return tr("Type the limit as a number, like %1, or nothing for no limit.").arg(Formatting::moneyExample());
        cents = *parsed;
    }
    return m_ledger->setLimit(m_categories.at(row), cents);
}
