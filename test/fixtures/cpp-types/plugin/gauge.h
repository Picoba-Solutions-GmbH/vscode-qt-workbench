#pragma once

#include <QObject>
#include <QtQmlIntegration>

namespace other {

// Another module's Gauge: renaming the one in src/ must leave this alone.
class Gauge : public QObject
{
    Q_OBJECT
    QML_ELEMENT
};

}
