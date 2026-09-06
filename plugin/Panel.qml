import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Status.js" as Status

Panel {
    id: root

    readonly property color accent: Color.accent
    property string actionError: ""
    readonly property bool available: !joined && !state.onlineError && people.length > 0
    readonly property bool busy: state.status === "joining" || state.status === "leaving"
    readonly property string ctl: Qt.resolvedUrl("echo-chamber-ctl").toString().replace("file://", "")
    readonly property color fg: bar ? bar.foreground : Color.foreground
    readonly property bool joined: state.status === "joined" || state.status === "reconnecting"
    readonly property string launcher: Quickshell.env("HOME") + "/.local/bin/echo-chamber"
    readonly property var people: joined ? (state.participants || []) : (state.online || [])
    property var state: ({
            status: "starting",
            participants: [],
            online: []
        })

    function send(command) {
        if (action.running)
            return;
        actionError = "";
        action.command = [root.ctl, "json", JSON.stringify(command)];
        action.running = true;
    }
    function showApp() {
        Quickshell.execDetached([root.launcher]);
        root.close();
    }

    implicitHeight: button.implicitHeight
    implicitWidth: button.implicitWidth
    ipcTarget: "local.echo-chamber"
    manageIpc: false
    moduleName: "local.echo-chamber"

    Process {
        id: watcher

        command: [root.ctl, "watch"]
        running: true

        stdout: SplitParser {
            onRead: data => {
                try {
                    const next = JSON.parse(data);
                    root.actionError = Status.reconciledActionError(root.state, next, root.actionError);
                    root.state = next;
                } catch (e) {}
            }
        }

        onExited: restart.restart()
    }
    Timer {
        id: restart

        interval: 3000

        onTriggered: watcher.running = true
    }
    Process {
        id: action

        stdout: SplitParser {
            onRead: data => {
                try {
                    var result = JSON.parse(data);
                    if (!result.ok)
                        root.actionError = result.error;
                } catch (e) {}
            }
        }
    }
    BarIconButton {
        id: button

        anchors.fill: parent
        bar: root.bar
        text: root.joined ? "󰋋" : root.available ? "󰥔" : "󰋎"
        tooltipText: root.joined ? "Echo Chamber · " + root.people.length + " in room" : root.available ? root.people.length + " online · Click for participants" : "Echo Chamber · Click to open"

        iconComponent: Component {
            Item {
                Text {
                    anchors.centerIn: parent
                    color: root.joined || root.available ? root.accent : root.fg
                    font.family: Style.font.family
                    font.pixelSize: Style.font.icon
                    opacity: root.joined || root.available ? 1 : 0.55
                    text: root.joined ? "󰋋" : root.available ? "󰥔" : "󰋎"
                }
                Rectangle {
                    anchors.bottom: parent.bottom
                    anchors.right: parent.right
                    color: root.state.onlineError ? "#e5ac97" : root.accent
                    height: 5
                    radius: 3
                    visible: !!root.state.onlineError || root.joined && root.people.some(p => p.speaking)
                    width: 5
                }
            }
        }

        onPressed: code => {
            if (code === Qt.RightButton)
                root.showApp();
            else
                root.toggle();
        }
    }
    KeyboardPanel {
        id: popup

        anchorItem: button
        bar: root.bar
        contentHeight: popup.fittedContentHeight(content.implicitHeight + 32, Style.space(620))
        contentWidth: popup.fittedContentWidth(Style.space(380))
        focusTarget: content
        open: root.opened
        owner: root

        Flickable {
            anchors.fill: parent
            clip: true
            contentHeight: content.implicitHeight + 32

            ColumnLayout {
                id: content

                focus: true
                spacing: 12
                width: parent.width - 32
                x: 16
                y: 16

                Keys.onEscapePressed: root.close()

                Text {
                    color: root.accent
                    font.letterSpacing: 2
                    font.pixelSize: 10
                    text: "ECHO CHAMBER"
                }
                RowLayout {
                    Layout.fillWidth: true

                    Text {
                        Layout.fillWidth: true
                        color: root.fg
                        elide: Text.ElideRight
                        font.pixelSize: 20
                        text: root.joined ? (root.state.room === "main" ? "Main" : root.state.room) : "Online participants"
                    }
                    Text {
                        color: root.fg
                        font.pixelSize: 11
                        opacity: 0.6
                        text: root.people.length + " online"
                    }
                }
                Text {
                    Layout.fillWidth: true
                    color: root.actionError || root.state.error || root.state.onlineError ? "#e5ac97" : root.fg
                    font.pixelSize: 11
                    opacity: 0.8
                    text: Status.message(root.state, root.actionError)
                    textFormat: Text.PlainText
                    wrapMode: Text.Wrap
                }
                Repeater {
                    model: root.people.length

                    Rectangle {
                        id: person

                        required property int index
                        readonly property var modelData: root.people[index] || ({})

                        Layout.fillWidth: true
                        border.color: person.modelData.speaking ? root.accent : "transparent"
                        color: person.modelData.speaking ? Qt.rgba(root.accent.r, root.accent.g, root.accent.b, 0.12) : Qt.rgba(root.fg.r, root.fg.g, root.fg.b, 0.04)
                        implicitHeight: personContent.implicitHeight + 24
                        radius: 8

                        ColumnLayout {
                            id: personContent

                            anchors.left: parent.left
                            anchors.margins: 12
                            anchors.right: parent.right
                            anchors.top: parent.top
                            spacing: 8

                            RowLayout {
                                Layout.fillWidth: true

                                Text {
                                    color: person.modelData.speaking ? root.accent : root.fg
                                    text: person.modelData.speaking ? "●" : "○"
                                }
                                Text {
                                    Layout.fillWidth: true
                                    color: root.fg
                                    elide: Text.ElideRight
                                    font.pixelSize: 13
                                    text: person.modelData.name + (person.modelData.self ? " · You" : "")
                                    textFormat: Text.PlainText
                                }
                                Text {
                                    color: root.accent
                                    font.pixelSize: 10
                                    text: "▣ LIVE"
                                    visible: !!person.modelData.sharing
                                }
                                Text {
                                    color: root.fg
                                    text: "󰍭"
                                    visible: !!person.modelData.micMuted
                                }
                            }
                            RowLayout {
                                Layout.fillWidth: true
                                visible: root.joined && !person.modelData.self

                                Button {
                                    Accessible.name: text + " " + person.modelData.name + " for you"
                                    enabled: !action.running
                                    text: person.modelData.muted ? "Unmute" : "Mute"

                                    onClicked: root.send({
                                        action: "mute",
                                        bus: "voice",
                                        identity: person.modelData.identity
                                    })
                                }
                                Slider {
                                    id: volume

                                    Accessible.name: person.modelData.name + " voice volume"
                                    Layout.fillWidth: true
                                    enabled: !action.running
                                    from: 0
                                    stepSize: 1
                                    to: 300
                                    value: person.modelData.volume === undefined ? 100 : person.modelData.volume

                                    Keys.onReleased: event => {
                                        if (event.key === Qt.Key_Left || event.key === Qt.Key_Right)
                                            root.send({
                                                action: "volume",
                                                bus: "voice",
                                                identity: person.modelData.identity,
                                                value: Math.round(value)
                                            });
                                    }
                                    onPressedChanged: if (!pressed)
                                        root.send({
                                            action: "volume",
                                                bus: "voice",
                                            identity: person.modelData.identity,
                                            value: Math.round(value)
                                        })
                                }
                                Text {
                                    Layout.preferredWidth: 32
                                    color: root.fg
                                    font.pixelSize: 10
                                    text: Math.round(volume.value) + "%"
                                }
                            }
                            RowLayout {
                                Layout.fillWidth: true
                                visible: root.joined && !person.modelData.self && !!person.modelData.sharing
                                Button {
                                    text: person.modelData.screenMuted ? "Unmute screen" : "Mute screen"
                                    enabled: !action.running
                                    onClicked: root.send({ action: "mute", bus: "screen", identity: person.modelData.identity })
                                }
                                Slider {
                                    id: screenVolume
                                    Accessible.name: person.modelData.name + " screen volume"
                                    Layout.fillWidth: true
                                    enabled: !action.running
                                    from: 0
                                    to: 300
                                    stepSize: 1
                                    value: person.modelData.screenVolume === undefined ? 100 : person.modelData.screenVolume
                                    Keys.onReleased: event => {
                                        if (event.key === Qt.Key_Left || event.key === Qt.Key_Right)
                                            root.send({ action: "volume", bus: "screen", identity: person.modelData.identity, value: Math.round(value) });
                                    }
                                    onPressedChanged: if (!pressed)
                                        root.send({ action: "volume", bus: "screen", identity: person.modelData.identity, value: Math.round(value) })
                                }
                                Text {
                                    Layout.preferredWidth: 32
                                    color: root.fg
                                    font.pixelSize: 10
                                    text: Math.round(screenVolume.value) + "%"
                                }
                            }
                            RowLayout {
                                Layout.fillWidth: true
                                visible: !root.joined

                                Text {
                                    Layout.fillWidth: true
                                    color: root.fg
                                    font.pixelSize: 11
                                    opacity: 0.6
                                    text: person.modelData.room || "main"
                                }
                                Button {
                                    enabled: !root.busy && !action.running
                                    text: "Join ↗"

                                    onClicked: root.send({
                                        action: "join",
                                        room: person.modelData.room || "main"
                                    })
                                }
                            }
                        }
                    }
                }
                Text {
                    Layout.fillWidth: true
                    color: root.fg
                    font.pixelSize: 12
                    opacity: 0.7
                    text: root.state.configured ? "No participants are connected." : "Configure a server to view participants."
                    visible: root.people.length === 0
                    wrapMode: Text.Wrap
                }
                RowLayout {
                    Layout.fillWidth: true

                    Button {
                        enabled: !root.busy && !action.running
                        text: root.joined ? (root.state.micMuted ? "Unmute mic" : "Mute mic") : (root.state.configured ? "Join main ↗" : "Set up")

                        onClicked: {
                            if (!root.state.configured)
                                root.showApp();
                            else
                                root.send({
                                    action: root.joined ? "mic" : "join",
                                    room: "main"
                                });
                        }
                    }
                    Button {
                        enabled: !action.running
                        text: "Leave"
                        visible: root.joined

                        onClicked: root.send({
                            action: "leave"
                        })
                    }
                    Item {
                        Layout.fillWidth: true
                    }
                    Button {
                        text: "Open app"

                        onClicked: root.showApp()
                    }
                }
            }
        }
    }
}
