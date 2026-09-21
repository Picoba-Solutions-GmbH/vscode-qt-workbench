#ifndef BASICS_H
#define BASICS_H

#include <QObject>
#include <QString>
#include <QtQmlIntegration>

// Exposed to QML as "VinceBackend" via QML_ELEMENT. Because backend.h/.cpp are
// listed in the SOURCES section of qt_add_qml_module(), the type is registered
// into the "Test" module automatically -- no manual qmlRegisterType() needed.
class BasicsViewModel : public QObject
{
    Q_OBJECT
    QML_ELEMENT

    Q_PROPERTY(QString message READ message WRITE setMessage NOTIFY messageChanged)
    Q_PROPERTY(int counter READ counter NOTIFY counterChanged)

public:
    explicit BasicsViewModel(QObject *parent = nullptr);

    BasicsViewModel(const BasicsViewModel &) = delete;
    BasicsViewModel(BasicsViewModel &&) = delete;
    BasicsViewModel &operator=(const BasicsViewModel &) = delete;
    BasicsViewModel &operator=(BasicsViewModel &&) = delete;
    QString message() const;
    void setMessage(const QString &message);

    int counter() const;

    // Methods callable straight from QML.
    Q_INVOKABLE void increment();
    Q_INVOKABLE void decrement();
    Q_INVOKABLE void reset();
    Q_INVOKABLE void greet(const QString &name);
    Q_INVOKABLE QString currentTime() const;
    Q_INVOKABLE int randomNumber(int min, int max) const;
    Q_INVOKABLE QString systemInfo() const;

signals:
    void messageChanged();
    void counterChanged();

private:
    QString m_message = QStringLiteral("Hello World");
    int m_counter = 0;
};

#endif // BASICS_H
