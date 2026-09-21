#ifndef PLCSIMULATOR_H
#define PLCSIMULATOR_H

#include <QObject>
#include <QString>
#include <QTimer>
#include <QtQmlIntegration>

#include <array>
#include <cstdint>

// A stand-in PLC, so PlcClient has something to talk to without hardware:
// snap7's server, listening on this computer only, with one data block.
//
// DB1, 16 bytes:
//   DBW0    INT   a counter, counting up twice a second
//   DBD2    REAL  a temperature, drifting between 15 and 25
//   DBX6.0  BOOL  a flag, toggling every second
//   DBW8    INT   a setpoint, left for the client to write
class PlcSimulator : public QObject
{
    Q_OBJECT
    QML_ELEMENT

    Q_PROPERTY(bool running READ running NOTIFY runningChanged)
    // A real PLC listens on port 102, which on Linux and macOS only
    // administrators may open; the simulator uses 1102 by default.
    Q_PROPERTY(int port READ port WRITE setPort NOTIFY portChanged)
    Q_PROPERTY(QString status READ status NOTIFY statusChanged)

public:
    static constexpr int DbNumber = 1;

    explicit PlcSimulator(QObject *parent = nullptr);
    ~PlcSimulator() override;

    bool running() const;
    int port() const;
    void setPort(int port);
    QString status() const;

    Q_INVOKABLE void start();
    Q_INVOKABLE void stop();

signals:
    void runningChanged();
    void portChanged();
    void statusChanged();

private:
    void tick();
    void setStatus(const QString &status);

    std::uintptr_t m_server = 0; // snap7's S7Object
    // The data block's memory. snap7's server threads read and write it
    // directly, so it is only changed between Srv_LockArea and Srv_UnlockArea.
    std::array<unsigned char, 16> m_db{};
    QTimer m_timer;
    int m_port = 1102;
    int m_ticks = 0;
    bool m_running = false;
    QString m_status;
};

#endif // PLCSIMULATOR_H
