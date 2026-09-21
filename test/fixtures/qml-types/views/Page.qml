import QtQuick
import "../widgets" as W
Item {
    W.Badge {}
    W.Panel {}
    Component.onCompleted: Qt.createComponent("Demo", "Badge")
}
