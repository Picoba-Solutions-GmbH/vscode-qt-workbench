import QtQuick
import %{ProjectName}

// How much of a limit is spent: a bar that fills up, and turns orange near
// the limit and red over it. Which status applies is the core's rule
// (Budget::status in core/domain/budget.h); what each looks like is decided
// here.
Rectangle {
    id: bar

    // What was spent, as a share of the limit: 1 is all of it.
    property real share: 0
    property int status: Budget.NoLimit

    implicitHeight: 8
    radius: height / 2
    color: "#26808080"

    Rectangle {
        width: bar.width * Math.min(bar.share, 1)
        height: bar.height
        radius: bar.radius
        visible: bar.status !== Budget.NoLimit
        color: bar.status === Budget.OverBudget ? "#e53935"
             : bar.status === Budget.NearLimit ? "#fb8c00"
             : "#43a047"

        Behavior on width {
            NumberAnimation {
                duration: 200
                easing.type: Easing.OutCubic
            }
        }
    }
}
