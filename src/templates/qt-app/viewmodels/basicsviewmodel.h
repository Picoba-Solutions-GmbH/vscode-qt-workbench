#ifndef BASICSVIEWMODEL_H
#define BASICSVIEWMODEL_H

#include <QObject>
#include <QString>
#include <QtQmlIntegration>

// QML_ELEMENT makes the class a QML type of the same name. Because this header
// is listed in the SOURCES of qt_add_qml_module(), the type is registered into
// the "%{ProjectName}" module automatically -- no qmlRegisterType() call is needed.
// QML then creates instances of it like any other type: BasicsViewModel { }.
class BasicsViewModel : public QObject
{
    Q_OBJECT
    QML_ELEMENT

    // A property QML can read, write and bind to. NOTIFY names the signal that
    // tells every binding on it to re-evaluate.
    Q_PROPERTY(QString message READ message WRITE setMessage NOTIFY messageChanged)
    // Read-only from QML: no WRITE.
    Q_PROPERTY(int counter READ counter NOTIFY counterChanged)

public:
    explicit BasicsViewModel(QObject *parent = nullptr);

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

#endif // BASICSVIEWMODEL_H
