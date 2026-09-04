-- How much work each day's route is, kept rather than recomputed: the depot
-- board asks for it every few seconds and the answer changes by the hour.
--
-- Materialized, so a reader has to know it can be stale - which is why the
-- catalog draws it differently from a view that is computed on the spot.
CREATE MATERIALIZED VIEW mv_route_load AS
SELECT r.id          AS route_id,
       r.vehicle     AS vehicle,
       r.planned_for AS planned_for,
       count(s.seq)  AS stops,
       count(s.seq) FILTER (WHERE s.done) AS done
  FROM routes r
  LEFT JOIN route_stops s ON s.route_id = r.id
 GROUP BY r.id;
