#pragma once

#include <QObject>
#include <QtQmlIntegration>

// Built into no target, so no module it could be registered in is known.
class Loose : public QObject
{
    Q_OBJECT
    QML_ELEMENT
};
