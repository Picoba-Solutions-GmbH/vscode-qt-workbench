#include "plcclient.h"

#include <QtEndian>

#include <cstring>

// snap7's C interface. It pulls in the system's socket headers (windows.h on
// Windows), so it is included here, after Qt, and never in a header.
#include <snap7/snap7_libmain.h>

namespace {

QString errorText(int code)
{
    char text[256] = {};
    Cli_ErrorText(code, text, sizeof text);
    return QString::fromLatin1(text).trimmed();
}

} // namespace

PlcClient::PlcClient(QObject *parent)
    : QObject(parent)
    , m_worker(new QObject)
{
    // An object belongs to the thread it was moved to: what
    // QMetaObject::invokeMethod() queues for it runs on that thread.
    m_worker->moveToThread(&m_thread);
    connect(&m_thread, &QThread::finished, m_worker, &QObject::deleteLater);
    m_thread.start();

    runOnWorker([this] { m_client = Cli_Create(); });
}

PlcClient::~PlcClient()
{
    // Wait for the worker to finish what is queued, then close the connection
    // there too, before the thread stops.
    QMetaObject::invokeMethod(
        m_worker,
        [this] {
            Cli_Disconnect(m_client);
            Cli_Destroy(m_client);
        },
        Qt::BlockingQueuedConnection);
    m_thread.quit();
    m_thread.wait();
}

template<typename Work>
void PlcClient::runOnWorker(Work work)
{
    if (++m_pending == 1)
        emit busyChanged();

    QMetaObject::invokeMethod(m_worker, [this, work] {
        work();
        // Back on the thread PlcClient lives in. Qt drops the call if PlcClient
        // was destroyed meanwhile.
        QMetaObject::invokeMethod(this, [this] {
            if (--m_pending == 0)
                emit busyChanged();
        });
    });
}

void PlcClient::finish(bool connected, const QString &status)
{
    if (m_connected != connected) {
        m_connected = connected;
        emit connectedChanged();
    }
    if (m_status != status) {
        m_status = status;
        emit statusChanged();
    }
}

bool PlcClient::connected() const
{
    return m_connected;
}

bool PlcClient::busy() const
{
    return m_pending > 0;
}

QString PlcClient::status() const
{
    return m_status;
}

void PlcClient::connectTo(const QString &address, int rack, int slot, int port)
{
    finish(false, tr("Connecting to %1:%2...").arg(address).arg(port));

    // Lambdas that run on the worker capture copies, never references to
    // members that the QML thread may change meanwhile.
    const QByteArray ip = address.toLatin1();
    runOnWorker([this, ip, rack, slot, port] {
        Cli_Disconnect(m_client);
        std::uint16_t remotePort = static_cast<std::uint16_t>(port);
        Cli_SetParam(m_client, p_u16_RemotePort, &remotePort);

        const int result = Cli_ConnectTo(m_client, ip.constData(), rack, slot);
        const QString status = result == 0 ? tr("Connected to %1").arg(QString::fromLatin1(ip))
                                           : errorText(result);
        QMetaObject::invokeMethod(this, [this, result, status] { finish(result == 0, status); });
    });
}

void PlcClient::disconnectFrom()
{
    runOnWorker([this] {
        Cli_Disconnect(m_client);
        QMetaObject::invokeMethod(this, [this] { finish(false, tr("Disconnected")); });
    });
}

void PlcClient::readDb(int db, int start, int size)
{
    runOnWorker([this, db, start, size] {
        QByteArray data(size, '\0');
        const int result = Cli_DBRead(m_client, db, start, size, data.data());

        int connected = 0;
        Cli_GetConnected(m_client, connected);
        QMetaObject::invokeMethod(this, [this, db, start, data, result, connected] {
            if (result == 0)
                emit dbRead(db, start, data);
            else
                finish(connected != 0, errorText(result));
        });
    });
}

void PlcClient::writeInt(int db, int offset, int value)
{
    runOnWorker([this, db, offset, value] {
        unsigned char bytes[2];
        qToBigEndian(static_cast<qint16>(value), bytes);
        const int result = Cli_DBWrite(m_client, db, offset, sizeof bytes, bytes);

        int connected = 0;
        Cli_GetConnected(m_client, connected);
        const QString status = result == 0 ? tr("Wrote %1 to DB%2.DBW%3").arg(value).arg(db).arg(offset)
                                           : errorText(result);
        QMetaObject::invokeMethod(this, [this, connected, status] { finish(connected != 0, status); });
    });
}

int PlcClient::intAt(const QByteArray &data, int offset)
{
    if (offset < 0 || offset + 2 > data.size())
        return 0;
    return qFromBigEndian<qint16>(data.constData() + offset);
}

double PlcClient::realAt(const QByteArray &data, int offset)
{
    if (offset < 0 || offset + 4 > data.size())
        return 0.0;
    // A REAL is an IEEE 754 float: swap the bytes, then reinterpret the bits.
    const quint32 bits = qFromBigEndian<quint32>(data.constData() + offset);
    float value;
    std::memcpy(&value, &bits, sizeof value);
    return value;
}

bool PlcClient::bitAt(const QByteArray &data, int offset, int bit)
{
    if (offset < 0 || offset >= data.size() || bit < 0 || bit > 7)
        return false;
    return (static_cast<unsigned char>(data.at(offset)) >> bit) & 1;
}

QString PlcClient::hex(const QByteArray &data)
{
    return QString::fromLatin1(data.toHex(' ').toUpper());
}
