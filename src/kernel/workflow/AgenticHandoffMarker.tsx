import LineageMarker from './LineageMarker';

/** The visible boundary between what the AI did and what the human owns.
 *  Thin assistant-tone wrapper over the reusable {@link LineageMarker}. */
export default function AgenticHandoffMarker({ summary }: { summary: string }) {
  return <LineageMarker summary={summary} actorKind="assistant" />;
}
