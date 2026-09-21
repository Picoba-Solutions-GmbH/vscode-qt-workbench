#include "plcsimulator.h"

#include <QtEndian>

#include <cmath>
#include <cstring>

#include <snap7/snap7_libmain.h>

PlcSimulator::PlcSimulator(QObject *parent)
    : QObject(parent)
    , m_server(Srv_Create())
{
    // The server serves the data block straight from m_db: no copying, and
    // what a client writes lands there.
    Srv_RegisterArea(m_server, srvAreaDB, DbNumber, m_db.data(), static_cast<int>(m_db.size()));

    m_timer.setInterval(500);
    connect(&m_timer, &QTimer::timeout, this, &PlcSimulator::tick);
    setStatus(tr("Stopped"));
}

PlcSimulator::~PlcSimulator()
{
    Srv_Stop(m_server);
    Srv_Destroy(m_server);
}

bool PlcSimulator::running() const
{
    return m_running;
}

int PlcSimulator::port() const
{
    return m_port;
}

void PlcSimulator::setPort(int port)
{
    if (m_port == port || m_running)
        return;

    m_port = port;
    emit portChanged();
}

QString PlcSimulator::status() const
{
    return m_status;
}

void PlcSimulator::setStatus(const QString &status)
{
    if (m_status == status)
        return;

    m_status = status;
    emit statusChanged();
}

void PlcSimulator::start()
{
    if (m_running)
        return;

    std::uint16_t localPort = static_cast<std::uint16_t>(m_port);
    Srv_SetParam(m_server, p_u16_LocalPort, &localPort);

    // 127.0.0.1: only programs on this computer can connect.
    const int result = Srv_StartTo(m_server, "127.0.0.1");
    if (result != 0) {
        char text[256] = {};
        Srv_ErrorText(result, text, sizeof text);
        setStatus(QString::fromLatin1(text).trimmed());
        return;
    }

    m_running = true;
    emit runningChanged();
    setStatus(tr("Listening on 127.0.0.1:%1").arg(m_port));
    m_timer.start();
}

void PlcSimulator::stop()
{
    if (!m_running)
        return;

    m_timer.stop();
    Srv_Stop(m_server);
    m_running = false;
    emit runningChanged();
    setStatus(tr("Stopped"));
}

void PlcSimulator::tick()
{
    ++m_ticks;
    const float temperature = 20.0f + 5.0f * static_cast<float>(std::sin(m_ticks / 10.0));
    quint32 temperatureBits;
    std::memcpy(&temperatureBits, &temperature, sizeof temperatureBits);

    Srv_LockArea(m_server, srvAreaDB, DbNumber);
    qToBigEndian(static_cast<qint16>(m_ticks), m_db.data() + 0);
    qToBigEndian(temperatureBits, m_db.data() + 2);
    if (m_ticks % 2 == 0)
        m_db[6] ^= 0x01;
    Srv_UnlockArea(m_server, srvAreaDB, DbNumber);
}
