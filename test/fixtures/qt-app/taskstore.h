#ifndef TASKSTORE_H
#define TASKSTORE_H

#include <QAbstractListModel>
#include <QString>
#include <QVariantMap>
#include <QVector>
#include <QtQmlIntegration>

// Plain data. Not a QObject -- it never crosses into QML by itself; the model
// hands out individual fields instead.
struct Task
{
    int id = 0;
    QString title;
    QString owner;
    QString notes;
    int priority = 1;
    bool done = false;
};

// The app-wide list of tasks.
//
// QAbstractListModel is Qt's answer to ObservableCollection<T>: it is the
// contract a ListView binds to. You implement three methods -- rowCount(),
// data() and roleNames() -- and the view calls them as it paints. The big
// difference from C# is that the view NEVER gets your Task objects; it asks
// "give me field X of row N", where X is a numeric role id that roleNames()
// maps to the string the QML delegate uses.
//
// It is also a QML_SINGLETON so every view shares the same data without any
// plumbing: TasksView and StatsView both just say "TaskStore".
class TaskStore : public QAbstractListModel
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

    Q_PROPERTY(int totalCount READ totalCount NOTIFY statsChanged)
    Q_PROPERTY(int doneCount READ doneCount NOTIFY statsChanged)
    Q_PROPERTY(int openCount READ openCount NOTIFY statsChanged)
    Q_PROPERTY(int highPriorityOpenCount READ highPriorityOpenCount NOTIFY statsChanged)

public:
    // The role ids. Qt::UserRole is where custom roles are allowed to start.
    // NOTE: none of these may be called "id" -- that name is reserved in QML,
    // so a delegate could never declare a property for it.
    enum Roles {
        TaskIdRole = Qt::UserRole + 1,
        TitleRole,
        OwnerRole,
        NotesRole,
        PriorityRole,
        DoneRole
    };
    Q_ENUM(Roles)

    explicit TaskStore(QObject *parent = nullptr);

    // --- the QAbstractListModel contract ---
    int rowCount(const QModelIndex &parent = QModelIndex()) const override;
    QVariant data(const QModelIndex &index, int role) const override;
    QHash<int, QByteArray> roleNames() const override;

    int totalCount() const;
    int doneCount() const;
    int openCount() const;
    int highPriorityOpenCount() const;

    // --- called from QML ---
    Q_INVOKABLE void addTask(const QString &title, const QString &owner, int priority);
    Q_INVOKABLE void removeTask(int taskId);
    Q_INVOKABLE void toggleDone(int taskId);
    Q_INVOKABLE void updateTask(int taskId,
                                const QString &title,
                                const QString &owner,
                                int priority,
                                const QString &notes);
    Q_INVOKABLE void clearCompleted();

    // Returns a QVariantMap, which arrives in QML as a plain JS object:
    // var t = TaskStore.taskById(3); console.log(t.title)
    Q_INVOKABLE QVariantMap taskById(int taskId) const;

signals:
    void statsChanged();
    // Fires on every add. QML listens with Connections { onTaskAdded: ... }.
    void taskAdded(const QString &title);

private:
    int rowOfId(int taskId) const;

    QVector<Task> m_tasks;
    int m_nextId = 1;
};

#endif // TASKSTORE_H
