import QtQuick
import QtCharts
Item {
    // uses a C++ registered singleton, must NOT grow a directory import
    property int n: TaskStore.count
}
