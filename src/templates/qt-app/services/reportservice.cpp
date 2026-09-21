#include "reportservice.h"

#include "taskstore.h"

#include <QDateTime>
#include <QTimer>

ReportService::ReportService(QObject *parent)
    : QObject(parent)
    , m_timer(new QTimer(this))
{
    m_timer->setSingleShot(true);
    m_timer->setInterval(1200);

    // connect() is Qt's event subscription. The lambda runs when the timer
    // fires -- on the main thread, so touching UI-bound state here is safe.
    connect(m_timer, &QTimer::timeout, this, [this]() {
        QString report;

        if (!m_source) {
            report = QStringLiteral("No source model assigned.");
        } else {
            report = QStringLiteral("Report generated %1\n\n"
                                    "Total tasks:      %2\n"
                                    "Completed:        %3\n"
                                    "Still open:       %4\n"
                                    "High priority:    %5")
                         .arg(QDateTime::currentDateTime().toString(QStringLiteral("HH:mm:ss")))
                         .arg(m_source->totalCount())
                         .arg(m_source->doneCount())
                         .arg(m_source->openCount())
                         .arg(m_source->highPriorityOpenCount());
        }

        setBusy(false);
        emit reportReady(report);
    });
}

bool ReportService::busy() const
{
    return m_busy;
}

void ReportService::setBusy(bool busy)
{
    if (m_busy == busy)
        return;

    m_busy = busy;
    emit busyChanged();
}

TaskStore *ReportService::source() const
{
    return m_source;
}

void ReportService::setSource(TaskStore *source)
{
    if (m_source == source)
        return;

    m_source = source;
    emit sourceChanged();
}

void ReportService::generate()
{
    if (m_busy)
        return;

    setBusy(true);
    m_timer->start();
}
