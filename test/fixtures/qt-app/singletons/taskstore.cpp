#include "../taskstore.h"

#include "../priority.h"

#include <QDebug>

TaskStore::TaskStore(QObject *parent)
    : QAbstractListModel(parent)
{
    // Seed data so the views have something to show on first launch.
    addTask(QStringLiteral("Wire up the C++ model"), QStringLiteral("Vince"), Priority::High);
    addTask(QStringLiteral("Learn QAbstractListModel"), QStringLiteral("Vince"), Priority::Normal);
    addTask(QStringLiteral("Review the theme singleton"), QStringLiteral("Kolja"), Priority::Normal);
    addTask(QStringLiteral("Ship the demo"), QStringLiteral("Kolja"), Priority::Low);

    m_tasks[1].done = true;
    emit statsChanged();
}

// --- QAbstractListModel contract -------------------------------------------

int TaskStore::rowCount(const QModelIndex &parent) const
{
    // A flat list has no nested rows, so a valid parent means "no children".
    if (parent.isValid())
        return 0;

    return static_cast<int>(m_tasks.size());
}

QVariant TaskStore::data(const QModelIndex &index, int role) const
{
    if (!index.isValid() || index.row() < 0 || index.row() >= m_tasks.size())
        return {};

    const Task &task = m_tasks.at(index.row());

    switch (role) {
    case TaskIdRole:
        return task.id;
    case TitleRole:
        return task.title;
    case OwnerRole:
        return task.owner;
    case NotesRole:
        return task.notes;
    case PriorityRole:
        return task.priority;
    case DoneRole:
        return task.done;
    default:
        return {};
    }
}

// Maps role ids to the names a QML delegate uses. "title" in the delegate ends
// up calling data(index, TitleRole) here.
QHash<int, QByteArray> TaskStore::roleNames() const
{
    return {
        { TaskIdRole, "taskId" },
        { TitleRole, "title" },
        { OwnerRole, "owner" },
        { NotesRole, "notes" },
        { PriorityRole, "priority" },
        { DoneRole, "done" },
    };
}

// --- stats ------------------------------------------------------------------

int TaskStore::totalCount() const
{
    return static_cast<int>(m_tasks.size());
}

int TaskStore::doneCount() const
{
    int count = 0;
    for (const Task &task : m_tasks) {
        if (task.done)
            ++count;
    }
    return count;
}

int TaskStore::openCount() const
{
    return totalCount() - doneCount();
}

int TaskStore::highPriorityOpenCount() const
{
    int count = 0;
    for (const Task &task : m_tasks) {
        if (!task.done && task.priority == Priority::High)
            ++count;
    }
    return count;
}

// --- mutations --------------------------------------------------------------

void TaskStore::addTask(const QString &title, const QString &owner, int priority)
{
    const QString trimmed = title.trimmed();
    if (trimmed.isEmpty())
        return;

    Task task;
    task.id = m_nextId++;
    task.title = trimmed;
    task.owner = owner.trimmed().isEmpty() ? QStringLiteral("Unassigned") : owner.trimmed();
    task.priority = qBound(0, priority, 2);

    // Every structural change must be announced, or the ListView will not know
    // a row appeared. beginInsertRows/endInsertRows is the required pair --
    // this is the part ObservableCollection does for you in C#.
    const int row = static_cast<int>(m_tasks.size());
    beginInsertRows(QModelIndex(), row, row);
    m_tasks.append(task);
    endInsertRows();

    emit statsChanged();
    emit taskAdded(task.title);
}

void TaskStore::removeTask(int taskId)
{
    const int row = rowOfId(taskId);
    if (row < 0)
        return;

    beginRemoveRows(QModelIndex(), row, row);
    m_tasks.removeAt(row);
    endRemoveRows();

    emit statsChanged();
}

void TaskStore::toggleDone(int taskId)
{
    const int row = rowOfId(taskId);
    if (row < 0)
        return;

    m_tasks[row].done = !m_tasks[row].done;

    // In-place edits use dataChanged() instead, naming the roles that changed.
    const QModelIndex changed = index(row, 0);
    emit dataChanged(changed, changed, { DoneRole });
    emit statsChanged();
}

void TaskStore::updateTask(int taskId,
                           const QString &title,
                           const QString &owner,
                           int priority,
                           const QString &notes)
{
    const int row = rowOfId(taskId);
    if (row < 0)
        return;

    Task &task = m_tasks[row];
    task.title = title.trimmed().isEmpty() ? task.title : title.trimmed();
    task.owner = owner.trimmed().isEmpty() ? QStringLiteral("Unassigned") : owner.trimmed();
    task.priority = qBound(0, priority, 2);
    task.notes = notes;

    const QModelIndex changed = index(row, 0);
    emit dataChanged(changed, changed, { TitleRole, OwnerRole, PriorityRole, NotesRole });
    emit statsChanged();
}

void TaskStore::clearCompleted()
{
    // Walk backwards so removing a row cannot shift rows we have not visited.
    for (int row = static_cast<int>(m_tasks.size()) - 1; row >= 0; --row) {
        if (!m_tasks.at(row).done)
            continue;

        beginRemoveRows(QModelIndex(), row, row);
        m_tasks.removeAt(row);
        endRemoveRows();
    }

    emit statsChanged();
}

QVariantMap TaskStore::taskById(int taskId) const
{
    const int row = rowOfId(taskId);
    if (row < 0)
        return {};

    const Task &task = m_tasks.at(row);
    return {
        { QStringLiteral("taskId"), task.id },
        { QStringLiteral("title"), task.title },
        { QStringLiteral("owner"), task.owner },
        { QStringLiteral("notes"), task.notes },
        { QStringLiteral("priority"), task.priority },
        { QStringLiteral("done"), task.done },
    };
}

int TaskStore::rowOfId(int taskId) const
{
    for (int row = 0; row < m_tasks.size(); ++row) {
        if (m_tasks.at(row).id == taskId)
            return row;
    }
    return -1;
}
