#pragma once

#include <QObject>
#include <QtQmlIntegration>

// QML knows it as Gauge too, through QML_ELEMENT.
class Gauge : public QObject
{
    Q_OBJECT
    QML_ELEMENT

public:
    enum Mode { Slow, Fast };
    Q_ENUM(Mode)

    explicit Gauge(QObject *parent = nullptr);
};
