#ifndef RESTSERVICE_H
#define RESTSERVICE_H

#include <QObject>
#include <QString>
#include <QVariant>
#include <QtQmlIntegration>

// REST calls with libcurl, replies read with nlohmann-json.
class RestService : public QObject
{
    Q_OBJECT
    QML_ELEMENT

    Q_PROPERTY(bool busy READ busy NOTIFY busyChanged)

public:
    explicit RestService(QObject *parent = nullptr);
    ~RestService() override;

    bool busy() const;

    // Sends GET `url`. A JSON reply comes as a JavaScript value in `data`.
    Q_INVOKABLE void get(const QString &url);

signals:
    void busyChanged();
    void replied(int status, const QVariant &data, const QString &body);
    void failed(const QString &error);

private:
    void setPending(int pending);

    int m_pending = 0;
};

#endif // RESTSERVICE_H