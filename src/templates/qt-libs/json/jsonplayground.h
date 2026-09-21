#ifndef JSONPLAYGROUND_H
#define JSONPLAYGROUND_H

#include <QObject>
#include <QString>
#include <QVariant>
#include <QtQmlIntegration>

// JSON with nlohmann-json: parsing text, writing it back formatted or minified,
// reading it into a C++ struct and handing it to QML.
//
// nlohmann::json never appears in this header, so the QML type registration
// Qt generates does not need the library's headers.
class JsonPlayground : public QObject
{
    Q_OBJECT
    QML_ELEMENT

    // Why the last call failed, or empty when it worked.
    Q_PROPERTY(QString error READ error NOTIFY errorChanged)

public:
    explicit JsonPlayground(QObject *parent = nullptr);

    QString error() const;

    // An example document, written from a C++ struct.
    Q_INVOKABLE QString sampleOrder() const;
    // The JSON text indented by `indent` spaces, or on one line when it is -1.
    Q_INVOKABLE QString format(const QString &text, int indent);
    // The JSON text read into the Order struct, described line by line.
    Q_INVOKABLE QString describeOrder(const QString &text);
    // The JSON text as a JavaScript value for QML.
    Q_INVOKABLE QVariant toVariant(const QString &text);

signals:
    void errorChanged();

private:
    void setError(const QString &error);

    QString m_error;
};

#endif // JSONPLAYGROUND_H
