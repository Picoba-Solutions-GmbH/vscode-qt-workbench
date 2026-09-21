#include <QQmlApplicationEngine>
int main() {
    QQmlApplicationEngine engine;
    engine.load(QUrl("qrc:/qt/qml/Demo/App/views/TasksView.qml"));
    QPixmap p(":/images/logo.png");
    return 0;
}
