import QtQuick
import "../widgets"
Item {
    Image { source: "../images/logo.png" }
    Loader { source: "../widgets/Badge.qml" }
    Component.onCompleted: Qt.createComponent("../widgets/Badge.qml")
}
