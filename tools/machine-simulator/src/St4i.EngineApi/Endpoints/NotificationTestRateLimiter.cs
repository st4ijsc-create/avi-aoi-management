namespace St4i.EngineApi.Endpoints;

/// <summary>
/// 🔴 Task C-7 — <b>the first rate limiter in this product.</b> Đợt B's review named the total absence of
/// rate limiting as its top carried item and deferred it; this pays the part of it C-7 owns, and it is
/// deliberately the smallest mechanism that does the job rather than the framework's.
///
/// <h3>What it limits, and why only this</h3>
/// <para><c>POST /v1/notifications/test</c> is the only route in this file that makes this product emit
/// something to a THIRD PARTY — an HTTP POST to a URL an operator supplied, or an e-mail through somebody
/// else's relay — with no bound of its own beyond one attempt timeout. Unlimited, an authenticated Engineer
/// (or a script holding their session) could use this engine as an outbound message generator against an
/// arbitrary host: every request costs this machine one socket and costs the receiver one message, and the
/// receiver is a Slack channel a shift is reading or a mailbox somebody is on call for. That asymmetry —
/// cheap here, expensive and visible there — is what makes this the route that needs a limit.</para>
///
/// <h3>🔴 What is deliberately NOT limited, argued</h3>
/// <list type="bullet">
/// <item><description><b>The configuration writes (PUT/DELETE).</b> They are bounded-cost local SQLite
/// upserts behind an authenticated Engineer or Admin session, they are idempotent, and they reach nothing
/// outside this machine. Against that, the cost of limiting them is real and lands at the worst moment: the
/// time an operator most needs to re-point a webhook or fix a recipient list is during an incident, when
/// they are typing fast and getting it wrong twice. <b>A configuration write refused during an alarm storm
/// is a worse failure than the flood it would prevent.</b> What actually addresses a stuck script here is
/// the audit row every one of those routes writes — which names the actor, the role and the change — and
/// that is forensics a rate limit does not provide.</description></item>
/// <item><description><b>The reads (GET).</b> Local SQLite reads and in-memory counters. Limiting them would
/// refuse a monitoring poller, and <c>GET /v1/notifications/status</c> is precisely the thing somebody
/// polls while an incident is in progress.</description></item>
/// <item><description><b>The SSE subscribe</b> (<c>GET /v1/alarms/annunciations</c>). Its cost is per LIVE
/// CONNECTION, not per connect, so a rate limit would bound the wrong quantity — a caller opening one
/// connection per second and never closing them stays inside any connect rate while the per-publish cost on
/// C-1's drain thread grows without bound. It is bounded by a CONCURRENCY CAP instead
/// (<see cref="St4i.EngineApi.Alarms.AlarmAnnunciationHub.MaxListeners"/>), which bounds the thing that
/// actually costs.</description></item>
/// <item><description><b>The alarm notifications themselves.</b> Not this class's to bound and already
/// bounded twice: C-1's edge detector absorbs the 5 s re-raise storm before any channel sees anything, and
/// C-6's per-instance write limiter bounds what the relay emits. 🔴 One residual, recorded rather than
/// silently accepted: a crash-looping engine re-announces every standing alarm once per restart
/// (<c>Restored</c>), which is bounded by restart rate and by each instance's minimum priority but by
/// nothing else. A <c>Restored</c> bucket would NOT cover C-5's connect-time replay either — that is
/// per-connection state which never passes the notifier at all.</description></item>
/// </list>
///
/// <h3>The mechanism</h3>
/// <para><b>One global bucket, not one per channel or per instance</b>, and that is the smaller AND the
/// stronger choice. The quantity worth bounding is "how fast can this product be made to emit outbound
/// messages", which is a property of the product rather than of a destination — and a per-key limiter would
/// need a key space bounded by caller-supplied instance names, i.e. a dictionary with an eviction policy and
/// a memory bound, to enforce something weaker. One timestamp behind one lock has no key space, no growth,
/// and no eviction policy to get wrong.</para>
///
/// <para><b>It REFUSES; it does not delay.</b> C-6's relay limiter delays and never drops, because dropping
/// a write could drop a beacon RELEASE. The opposite is right here: a delayed HTTP request holds a request
/// thread and a socket while bounding nothing — a stuck script simply opens more connections — whereas a
/// 429 with <c>Retry-After</c> costs almost nothing and tells the caller exactly when to come back. And a
/// send test is repeatable by definition; a notification is not.</para>
///
/// <para><b>Stamped on ACCEPTANCE, before the send, not after it.</b> The same discipline C-6 uses: stamping
/// on completion would let a slow receiver stretch the interval, so the bound would be on how fast requests
/// FINISH rather than on how fast this product can be made to start them.</para>
/// </summary>
public sealed class NotificationTestRateLimiter
{
    /// <summary>
    /// The minimum interval between ACCEPTED send tests.
    ///
    /// <para><b>Five seconds, argued.</b> It is the per-attempt timeout of both testable channels
    /// (<see cref="St4i.EngineApi.Alarms.WebhookNotificationChannel.DefaultAttemptTimeout"/> and
    /// <see cref="St4i.EngineApi.Alarms.SmtpNotificationChannel.DefaultAttemptTimeout"/> are both 5 s), and a
    /// test makes exactly one attempt — so at this interval there is at most about one test send in flight
    /// at a time, which is the honest meaning of "this product will not be made to flood anybody". A human
    /// pressing "Send test", reading the result and pressing it again takes longer than this; a script gets
    /// twelve sends a minute instead of as many as it can open sockets for.</para>
    /// </summary>
    public static readonly TimeSpan DefaultMinInterval = TimeSpan.FromSeconds(5);

    private readonly object _gate = new();
    private DateTimeOffset? _lastAccepted;

    /// <param name="minInterval">Injectable for the same reason C-6's is: a bound is proven by measuring
    /// ELAPSED TIME against it, and a test that had to wait out the production interval to do so would be a
    /// test nobody runs. Production never passes this.</param>
    public NotificationTestRateLimiter(TimeSpan? minInterval = null)
    {
        MinInterval = minInterval ?? DefaultMinInterval;
    }

    public TimeSpan MinInterval { get; }

    /// <summary>
    /// Whether a send test may proceed NOW, stamping the clock if it may.
    /// </summary>
    /// <param name="retryAfter">How long the caller must wait. Meaningful only when this returns
    /// <see langword="false"/>.</param>
    public bool TryAcquire(DateTimeOffset now, out TimeSpan retryAfter)
    {
        lock (_gate)
        {
            if (_lastAccepted is { } last)
            {
                var since = now - last;
                if (since < MinInterval)
                {
                    // A clock that went BACKWARDS (an NTP correction, a VM resume) makes `since` negative,
                    // which lands here and simply refuses until the interval has genuinely elapsed against
                    // the new clock. Refusing for at most one interval is the safe direction: the failure is
                    // an operator pressing a button twice, and the alternative — treating a backwards jump
                    // as "plenty of time has passed" — is the limiter silently not applying.
                    retryAfter = MinInterval - since;
                    if (retryAfter > MinInterval) retryAfter = MinInterval;
                    return false;
                }
            }

            _lastAccepted = now;
            retryAfter = TimeSpan.Zero;
            return true;
        }
    }
}
