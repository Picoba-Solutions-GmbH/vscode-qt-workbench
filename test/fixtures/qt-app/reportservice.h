#ifndef REPORTSERVICE_H
#define REPORTSERVICE_H

#include <QObject>
#include <QString>
#include <QtQmlIntegration>

#include "taskstore.h"

class QTimer;

// Demonstrates work that finishes LATER: QML calls generate(), gets control
// back immediately, and hears about the result through a signal.
//
// The signal/handler pair is the Qt equivalent of C# events, and it is how you
// would surface anything genuinely async (a network reply, a DB query, a
// worker thread). Here a QTimer stands in for the slow part so the demo has no
// external dependencies.
class ReportService : public QObject
{
    Q_OBJECT
    QML_ELEMENT

    Q_PROPERTY(bool busy READ busy NOTIFY busyChanged)
    // A QObject* property. QML assigns the singleton straight into it:
    //     ReportService { source: TaskStore }
    Q_PROPERTY(TaskStore *source READ source WRITE setSource NOTIFY sourceChanged)

public:
    explicit ReportService(QObject *parent = nullptr);

    bool busy() const;

    TaskStore *source() const;
    void setSource(TaskStore *source);

    Q_INVOKABLE void generate();

signals:
    void busyChanged();
    void sourceChanged();
    // QML handles this as:  onReportReady: (report) => { ... }
    void reportReady(const QString &report);

private:
    void setBusy(bool busy);

    QTimer *m_timer = nullptr;
    TaskStore *m_source = nullptr;
    bool m_busy = false;
};

#endif // REPORTSERVICE_H
