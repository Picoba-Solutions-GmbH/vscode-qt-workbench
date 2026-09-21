#ifndef PRIORITY_H
#define PRIORITY_H

#include <QObject>
#include <QtQmlIntegration>

// A type that exists only to carry an enum into QML.
//
// QML_UNCREATABLE means QML may refer to the type (Priority.High) but may not
// instantiate it -- writing "Priority { }" becomes an error with the message
// below. Q_ENUM is what puts the enumerators into the meta-object so QML can
// resolve them by name. In C# you would just expose the enum directly; C++
// enums have no runtime names without this.
class Priority : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_UNCREATABLE("Priority only carries enum values; it cannot be instantiated.")

public:
    enum Level {
        Low = 0,
        Normal = 1,
        High = 2
    };
    Q_ENUM(Level)

    using QObject::QObject;
};

#endif // PRIORITY_H
