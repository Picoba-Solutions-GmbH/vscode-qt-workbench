#pragma once

#include <QObject>
#include <QtQmlIntegration>

// QML calls this one Knob, whatever the class is called.
class Dial : public QObject
{
    Q_OBJECT
    QML_NAMED_ELEMENT(Knob)
};
