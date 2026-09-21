#include "taskfilterproxy.h"

#include "taskstore.h"

TaskFilterProxy::TaskFilterProxy(QObject *parent)
    : QSortFilterProxyModel(parent)
{
    // "count" has no natural notify signal, so derive one from the row signals
    // the base class already emits.
    connect(this, &QAbstractItemModel::rowsInserted, this, &TaskFilterProxy::countChanged);
    connect(this, &QAbstractItemModel::rowsRemoved, this, &TaskFilterProxy::countChanged);
    connect(this, &QAbstractItemModel::modelReset, this, &TaskFilterProxy::countChanged);
}

QString TaskFilterProxy::searchText() const
{
    return m_searchText;
}

void TaskFilterProxy::setSearchText(const QString &searchText)
{
    if (m_searchText == searchText)
        return;

    m_searchText = searchText;
    emit searchTextChanged();

    // Tells the base class our criteria changed, so it re-runs
    // filterAcceptsRow() over every source row.
    beginFilterChange();
    endFilterChange(QSortFilterProxyModel::Direction::Rows);
    emit countChanged();
}

bool TaskFilterProxy::showCompleted() const
{
    return m_showCompleted;
}

void TaskFilterProxy::setShowCompleted(bool showCompleted)
{
    if (m_showCompleted == showCompleted)
        return;

    m_showCompleted = showCompleted;
    emit showCompletedChanged();

    beginFilterChange();
    endFilterChange(QSortFilterProxyModel::Direction::Rows);
    emit countChanged();
}

int TaskFilterProxy::count() const
{
    return rowCount();
}

bool TaskFilterProxy::filterAcceptsRow(int sourceRow, const QModelIndex &sourceParent) const
{
    const QAbstractItemModel *source = sourceModel();
    if (!source)
        return false;

    const QModelIndex sourceIndex = source->index(sourceRow, 0, sourceParent);

    if (!m_showCompleted && source->data(sourceIndex, TaskStore::DoneRole).toBool())
        return false;

    if (m_searchText.isEmpty())
        return true;

    const QString title = source->data(sourceIndex, TaskStore::TitleRole).toString();
    const QString owner = source->data(sourceIndex, TaskStore::OwnerRole).toString();

    return title.contains(m_searchText, Qt::CaseInsensitive)
        || owner.contains(m_searchText, Qt::CaseInsensitive);
}
