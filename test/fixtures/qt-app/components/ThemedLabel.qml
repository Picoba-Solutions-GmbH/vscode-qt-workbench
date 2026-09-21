pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls.Basic

// Controls.Basic paints label text black by default, which disappears in dark
// mode. Every view uses this instead of a bare Label.
Label {
    color: AppTheme.text
    wrapMode: Text.WordWrap
}
