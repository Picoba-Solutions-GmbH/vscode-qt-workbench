pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls.Basic

TextField {
    id: control

    color: AppTheme.text
    placeholderTextColor: AppTheme.subtleText
    leftPadding: 10
    rightPadding: 10

    background: Rectangle {
        implicitWidth: 160
        implicitHeight: 34
        radius: 8
        color: AppTheme.surface
        border.width: 1
        border.color: control.activeFocus ? AppTheme.accent : AppTheme.border
    }
}
