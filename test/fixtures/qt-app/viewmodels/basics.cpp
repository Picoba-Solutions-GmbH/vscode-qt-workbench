#include "../basics.h"

#include <QDateTime>
#include <QDebug>
#include <QLocale>
#include <QRandomGenerator>
#include <QSysInfo>

#include <utility>

BasicsViewModel::BasicsViewModel(QObject *parent)
    : QObject(parent)
{
}

QString BasicsViewModel::message() const
{
    return m_message;
}

void BasicsViewModel::setMessage(const QString &message)
{
    if (m_message == message)
        return;

    m_message = message;
    emit messageChanged();
}

int BasicsViewModel::counter() const
{
    return m_counter;
}

void BasicsViewModel::increment()
{
    ++m_counter;
    qDebug() << "Backend::increment() ->" << m_counter;
    emit counterChanged();
}

void BasicsViewModel::decrement()
{
    --m_counter;
    qDebug() << "Backend::decrement() ->" << m_counter;
    emit counterChanged();
}

void BasicsViewModel::reset()
{
    qDebug() << "Backend::reset()";
    m_counter = 0;
    emit counterChanged();
    setMessage(QStringLiteral("Hello World"));
}

void BasicsViewModel::greet(const QString &name)
{
    const QString trimmed = name.trimmed();
    qDebug() << "Backend::greet()" << trimmed;
    setMessage(trimmed.isEmpty() ? QStringLiteral("Hello World")
                                 : QStringLiteral("Hello %1").arg(trimmed));
}

QString BasicsViewModel::currentTime() const
{
    return QLocale::system().toString(QDateTime::currentDateTime(), QLocale::ShortFormat);
}

int BasicsViewModel::randomNumber(int min, int max) const
{
    if (min > max)
        std::swap(min, max);

    return QRandomGenerator::global()->bounded(min, max + 1);
}

QString BasicsViewModel::systemInfo() const
{
    return QStringLiteral("%1 %2 (%3) - Qt %4")
        .arg(QSysInfo::prettyProductName(),
             QSysInfo::productVersion(),
             QSysInfo::currentCpuArchitecture(),
             QStringLiteral(QT_VERSION_STR));
}
