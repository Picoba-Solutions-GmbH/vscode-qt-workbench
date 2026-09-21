#include "expensesviewmodel.h"

#include "formatting.h"

#include "domain/ledger.h"

#include <QJSEngine>

ExpensesViewModel::ExpensesViewModel(Ledger *ledger, QObject *parent)
    : QAbstractListModel(parent)
    , m_ledger(ledger)
    , m_rows(ledger->expenses())
{
    s_instance = this;

    // A view has to be told of a change before it asks for the new rows, and
    // the ledger has changed already when it says so. So the model keeps a
    // copy of the ledger's list -- cheap: a QList shares its data until one
    // side changes it -- and takes the new one between begin...() and
    // end...(), which is when the view expects the change.
    connect(ledger, &Ledger::expenseAdded, this, [this](int row) {
        beginInsertRows(QModelIndex(), row, row);
        m_rows = m_ledger->expenses();
        endInsertRows();
    });
    connect(ledger, &Ledger::expenseRemoved, this, [this](int row) {
        beginRemoveRows(QModelIndex(), row, row);
        m_rows = m_ledger->expenses();
        endRemoveRows();
    });
    connect(ledger, &Ledger::wasReset, this, [this]() {
        beginResetModel();
        m_rows = m_ledger->expenses();
        endResetModel();
    });
    connect(ledger, &Ledger::changed, this, &ExpensesViewModel::totalsChanged);
}

ExpensesViewModel::~ExpensesViewModel()
{
    if (s_instance == this)
        s_instance = nullptr;
}

ExpensesViewModel *ExpensesViewModel::create(QQmlEngine *, QJSEngine *)
{
    Q_ASSERT_X(s_instance, "ExpensesViewModel::create", "main() makes the view model before QML uses it");
    // The engine deletes a singleton it owns. This one is main()'s.
    QJSEngine::setObjectOwnership(s_instance, QJSEngine::CppOwnership);
    return s_instance;
}

int ExpensesViewModel::rowCount(const QModelIndex &parent) const
{
    if (parent.isValid())
        return 0;
    return static_cast<int>(m_rows.size());
}

QVariant ExpensesViewModel::data(const QModelIndex &index, int role) const
{
    if (!index.isValid() || index.row() >= m_rows.size())
        return {};

    const Expense &expense = m_rows.at(index.row());
    switch (role) {
    case ExpenseIdRole:
        return expense.id;
    case DateRole:
        return Formatting::date(expense.date);
    case DescriptionRole:
        return expense.description;
    case CategoryRole:
        return Formatting::categoryName(expense.category);
    case AmountRole:
        return Formatting::money(expense.amountCents);
    default:
        return {};
    }
}

QHash<int, QByteArray> ExpensesViewModel::roleNames() const
{
    return {
        { ExpenseIdRole, "expenseId" },
        { DateRole, "date" },
        { DescriptionRole, "description" },
        { CategoryRole, "category" },
        { AmountRole, "amount" },
    };
}

QString ExpensesViewModel::month() const
{
    return Formatting::month(QDate::currentDate());
}

QString ExpensesViewModel::monthTotal() const
{
    return Formatting::money(m_ledger->spentInMonth(QDate::currentDate()));
}

QStringList ExpensesViewModel::categoryNames() const
{
    QStringList names;
    for (Category::Kind category : Category::all())
        names.append(Formatting::categoryName(category));
    return names;
}

QString ExpensesViewModel::add(const QString &description, const QString &amount, int category)
{
    // `category` is a position in categoryNames, which lists Category::all().
    const QList<Category::Kind> categories = Category::all();
    if (category < 0 || category >= categories.size())
        return tr("Choose a category.");
    const std::optional<qint64> cents = Formatting::parseMoney(amount);
    if (!cents)
        return tr("Type the amount as a number, like %1.").arg(Formatting::moneyExample());

    Expense expense;
    expense.date = QDate::currentDate();
    expense.description = description;
    expense.category = categories.at(category);
    expense.amountCents = *cents;
    // Whether it may be added is the core's rule: the ledger says what is
    // wrong with it, if anything.
    return m_ledger->add(expense);
}

void ExpensesViewModel::remove(int expenseId)
{
    m_ledger->remove(expenseId);
}
