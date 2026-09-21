#ifndef TASKFILTERPROXY_H
#define TASKFILTERPROXY_H

#include <QSortFilterProxyModel>
#include <QtQmlIntegration>

// A filtering view over TaskStore.
//
// A proxy model wraps another model and re-presents it: same data, fewer or
// reordered rows. The ListView binds to the proxy and never knows the source
// changed. Roughly ICollectionView / CollectionViewSource in WPF, but the
// filtering runs in C++.
//
// This one is QML_ELEMENT (not a singleton) on purpose: each view that wants
// its own filter creates its own instance, all pointed at the one TaskStore.
class TaskFilterProxy : public QSortFilterProxyModel
{
    Q_OBJECT
    QML_ELEMENT

    Q_PROPERTY(QString searchText READ searchText WRITE setSearchText NOTIFY searchTextChanged)
    Q_PROPERTY(bool showCompleted READ showCompleted WRITE setShowCompleted NOTIFY showCompletedChanged)
    Q_PROPERTY(int count READ count NOTIFY countChanged)

public:
    explicit TaskFilterProxy(QObject *parent = nullptr);

    QString searchText() const;
    void setSearchText(const QString &searchText);

    bool showCompleted() const;
    void setShowCompleted(bool showCompleted);

    int count() const;

signals:
    void searchTextChanged();
    void showCompletedChanged();
    void countChanged();

protected:
    // Called by Qt for every source row. Return false to hide it.
    bool filterAcceptsRow(int sourceRow, const QModelIndex &sourceParent) const override;

private:
    QString m_searchText;
    bool m_showCompleted = true;
};

#endif // TASKFILTERPROXY_H
