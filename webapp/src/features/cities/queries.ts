import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createCity,
  deleteCity,
  fetchCities,
  recomputeCityTripsCount,
  renameCity,
  type FetchCitiesParams,
} from "./api";

const citiesKey = (p: FetchCitiesParams) => ["admin", "cities", p] as const;

export function useCitiesQuery(params: FetchCitiesParams) {
  return useQuery({
    queryKey: citiesKey(params),
    queryFn: () => fetchCities(params),
  });
}

export function useCreateCityMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => createCity(name),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "cities"] });
    },
  });
}

export function useUpdateCityMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      renameCity(id, name),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "cities"] });
    },
  });
}

export function useDeleteCityMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteCity(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "cities"] });
    },
  });
}

export function useRecomputeCityTripsCountMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: recomputeCityTripsCount,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "cities"] });
    },
  });
}
