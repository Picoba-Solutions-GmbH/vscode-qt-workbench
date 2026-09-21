#include <QQmlApplicationEngine>
using namespace Qt::StringLiterals;
int main() {
    QQmlApplicationEngine engine;
    engine.loadFromModule(u"Demo"_s, u"Badge"_s);
    engine.loadFromModule(QStringLiteral("Other.Module"), QStringLiteral("Badge"));
    return 0;
}
