pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls.Basic

// Reads its colours straight from the AppTheme singleton, so nothing has to be
// passed down from the window. accentColor and outlined are the two things a
// call site may change.
Button {
    id: control

    property color accentColor: AppTheme.accent
    property bool outlined: false

    padding: 10

    contentItem: Text {
        text: control.text
        color: control.outlined ? control.accentColor : AppTheme.textOnAccent
        font: control.font
        elide: Text.ElideRight
        horizontalAlignment: Text.AlignHCenter
        verticalAlignment: Text.AlignVCenter
    }

    background: Rectangle {
        implicitWidth: 92
        implicitHeight: 34
        radius: 8
        color: control.outlined ? "transparent" : control.accentColor
        border.width: control.outlined ? 1 : 0
        border.color: control.accentColor
        opacity: !control.enabled ? 0.4
                                  : (control.down ? 0.65 : (control.hovered ? 0.85 : 1.0))
    }
}
