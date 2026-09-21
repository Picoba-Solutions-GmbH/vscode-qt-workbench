#include <QQmlApplicationEngine>

#include "gauge.h"

int main()
{
    Gauge gauge;
    QQmlApplicationEngine engine;
    engine.loadFromModule("Demo", "Main");
    engine.loadFromModule("Demo", "Gauge");
    engine.loadFromModule("Other", "Gauge");
    return 0;
}
