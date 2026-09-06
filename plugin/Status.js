// Shared with the regression tests; compatible with Quickshell's JS imports.
function reconciledActionError(previous, next, error) {
  // Action errors describe the session in which they happened. Keep them
  // through roster/activity refreshes, but retire them when that session moves on.
  if (
    !!previous.signedIn !== !!next.signedIn ||
    !!previous.configured !== !!next.configured ||
    previous.status !== next.status
  )
    return "";
  return error;
}

function message(state, actionError) {
  if (actionError || state.error || state.onlineError)
    return actionError || state.error || state.onlineError;
  if (state.status === "joining") return "Joining the room…";
  if (state.status === "leaving") return "Leaving the room…";
  if (state.status === "reconnecting") return "Reconnecting to the room…";
  if (state.status === "joined")
    return (
      "Connected · " + (state.micMuted ? "Your mic is off" : "Your mic is on")
    );
  if (state.signedIn) return "Signed in · Ready to join";
  if (state.configured) return "Sign in in the app to join a room.";
  return "Set up your server in the app.";
}
