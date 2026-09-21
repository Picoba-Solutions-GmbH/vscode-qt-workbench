import QtQuick
// A Badge sits in the corner of every Panel.
Rectangle {
    id: root
    property Badge badge: Badge { size: Badge.Small }
    property string label: "Badge"
    property var other: root.Badge
    function make(): Badge { return badge }
}
