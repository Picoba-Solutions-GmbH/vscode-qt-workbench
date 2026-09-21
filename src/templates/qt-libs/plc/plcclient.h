#ifndef PLCCLIENT_H
#define PLCCLIENT_H

#include <QByteArray>
#include <QObject>
#include <QString>
#include <QThread>
#include <QtQmlIntegration>

#include <cstdint>

// A client for Siemens S7 PLCs with snap7. It talks S7 over ISO-on-TCP, the
// protocol of S7-300/400/1200/1500 PLCs, on TCP port 102.
//
// snap7's calls block until the PLC answers, which on a slow network or an
// unreachable address takes seconds. So they run on a worker thread: QML calls
// connectTo() or readDb(), which return at once, and hears about the outcome
// through signals and the properties below.
class PlcClient : public QObject
{
    Q_OBJECT
    QML_ELEMENT

    Q_PROPERTY(bool connected READ connected NOTIFY connectedChanged)
    Q_PROPERTY(bool busy READ busy NOTIFY busyChanged)
    Q_PROPERTY(QString status READ status NOTIFY statusChanged)

public:
    explicit PlcClient(QObject *parent = nullptr);
    ~PlcClient() override;

    bool connected() const;
    bool busy() const;
    QString status() const;

    // Rack and slot locate the CPU: 0 and 2 for an S7-300, 0 and 1 for an
    // S7-1200/1500. port is 102 for a real PLC.
    Q_INVOKABLE void connectTo(const QString &address, int rack, int slot, int port);
    Q_INVOKABLE void disconnectFrom();
    // Reads `size` bytes of data block `db` from byte `start`; dbRead() brings them.
    Q_INVOKABLE void readDb(int db, int start, int size);
    // Writes an INT (16 bits) to data block `db` at byte `offset`.
    Q_INVOKABLE void writeInt(int db, int offset, int value);

    // S7 stores numbers big-endian. These read them out of the bytes dbRead() brought.
    Q_INVOKABLE static int intAt(const QByteArray &data, int offset);
    Q_INVOKABLE static double realAt(const QByteArray &data, int offset);
    Q_INVOKABLE static bool bitAt(const QByteArray &data, int offset, int bit);
    Q_INVOKABLE static QString hex(const QByteArray &data);

signals:
    void connectedChanged();
    void busyChanged();
    void statusChanged();
    void dbRead(int db, int start, const QByteArray &data);

private:
    // Runs `work` on the worker thread, where the snap7 client lives.
    template<typename Work>
    void runOnWorker(Work work);
    void finish(bool connected, const QString &status);

    QThread m_thread;
    QObject *m_worker = nullptr;
    std::uintptr_t m_client = 0; // snap7's S7Object; used on the worker thread only
    bool m_connected = false;
    int m_pending = 0; // calls queued for the worker and not finished yet
    QString m_status;
};

#endif // PLCCLIENT_H
