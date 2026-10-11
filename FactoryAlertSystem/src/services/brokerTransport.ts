/**
 * Which transport a connection to the MQTT broker uses, and whether the device password may ride on it
 * (doc 81 Đợt 7 task J2). Pure functions: mqttService computes ONE plan per connect()/testConnection() and uses
 * the same plan for the socket and for the password decision, so the two cannot disagree.
 *
 * Rules (fail-closed):
 *   · TCP + TLS ⇒ ONLY the pinned TLS socket (native PinnedTlsSocket), with the certificate fingerprint saved
 *     together with the device password for exactly this endpoint. No fingerprint for this endpoint ⇒ REFUSE
 *     (TLS_PIN_REQUIRED); no native module (iOS, old shell) ⇒ REFUSE (TLS_PIN_UNSUPPORTED). There is no
 *     "accept any certificate" fallback — the old options that skipped certificate checks are gone.
 *   · TCP without TLS on Android ⇒ the plaintext react-native-tcp-socket path (unchanged; kept until migration).
 *   · WebSocket (ws/wss) and non-Android TCP ⇒ mqtt.connect(url) (wss uses the system CA store).
 *   · Device password: only to the endpoint it was pinned to (R-5-a). Once a certificate fingerprint is stored
 *     with it, ONLY over the pinned TLS socket with that same fingerprint — never over plain TCP/WS, never over
 *     a TLS connection verified some other way.
 */
import { MqttBrokerEndpoint, StoredMqttDeviceCredential, sameBrokerEndpoint } from './secureCredentialStore';

export type TlsRefusalCode = 'TLS_PIN_REQUIRED' | 'TLS_PIN_UNSUPPORTED';

export type BrokerTransportPlan =
  | { kind: 'pinned-tls'; host: string; port: number; pinSha256: string }
  | { kind: 'tcp-plain'; host: string; port: number }
  | { kind: 'url' }
  | { kind: 'refuse'; code: TlsRefusalCode };

export interface TransportInput {
  platformOS: string;
  protocol: string | undefined;
  useSSL: boolean | undefined;
  /** Address actually dialled (after the emulator localhost rewrite). */
  host: string;
  port: number;
  /** Endpoint identity of the config being connected to (brokerEndpointOf). */
  target: MqttBrokerEndpoint | null;
  credential: StoredMqttDeviceCredential | null;
  pinnedTlsAvailable: boolean;
}

export function planBrokerTransport(i: TransportInput): BrokerTransportPlan {
  const tcp = i.protocol === 'tcp';
  if (tcp && i.useSSL === true) {
    if (!i.pinnedTlsAvailable) return { kind: 'refuse', code: 'TLS_PIN_UNSUPPORTED' };
    const c = i.credential;
    const pin = c && c.certSha256 && sameBrokerEndpoint(c.endpoint, i.target) ? c.certSha256 : null;
    if (!pin) return { kind: 'refuse', code: 'TLS_PIN_REQUIRED' };
    return { kind: 'pinned-tls', host: i.host, port: i.port, pinSha256: pin };
  }
  if (tcp && i.platformOS === 'android') return { kind: 'tcp-plain', host: i.host, port: i.port };
  return { kind: 'url' };
}

export type DevicePasswordDecision =
  | { state: 'none' }
  | { state: 'sent'; password: string }
  | { state: 'withheld'; reason: 'endpoint' | 'needs-pinned-tls' | 'refused' };

/** May the stored device password go out on this plan to this target? */
export function devicePasswordFor(
  plan: BrokerTransportPlan,
  credential: StoredMqttDeviceCredential | null,
  target: MqttBrokerEndpoint | null,
): DevicePasswordDecision {
  if (!credential) return { state: 'none' };
  if (plan.kind === 'refuse') return { state: 'withheld', reason: 'refused' };
  if (!sameBrokerEndpoint(credential.endpoint, target)) return { state: 'withheld', reason: 'endpoint' };
  if (credential.certSha256) {
    if (plan.kind === 'pinned-tls' && plan.pinSha256 === credential.certSha256) {
      return { state: 'sent', password: credential.password };
    }
    return { state: 'withheld', reason: 'needs-pinned-tls' };
  }
  return { state: 'sent', password: credential.password };
}
